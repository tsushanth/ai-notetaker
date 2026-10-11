// LLM health: records the outcome of every call made through the shared Anthropic client, so the admin page can show
// success rate, latency and errors from real traffic. Stored in public.llm_calls (see scripts/llm-calls-migration.sql).
//
// Privacy: a row holds only outcome, timing, model, token counts and the first 200 characters of a provider error message.
// Never a prompt, a completion or a user id.
//
// Two Fly machines serve this app (one scales to zero), so counts live in the database and not in memory. Rows are buffered
// and written in batches; a failed write drops the batch and never affects the request being served.

const MAX_MESSAGE = 200;

const trim = (s) => String(s ?? '').replace(/\s+/g, ' ').slice(0, MAX_MESSAGE);

function okRow({ params, res, started, now, source }) {
  return {
    ts: new Date(now()).toISOString(),
    source,
    model: res?.model || params?.model || null,
    ok: true,
    status: null,
    error_type: null,
    error_message: null,
    latency_ms: Math.max(0, now() - started),
    input_tokens: Number.isFinite(res?.usage?.input_tokens) ? res.usage.input_tokens : null,
    output_tokens: Number.isFinite(res?.usage?.output_tokens) ? res.usage.output_tokens : null,
  };
}

function failRow({ params, err, started, now, source }) {
  return {
    ts: new Date(now()).toISOString(),
    source,
    model: params?.model || null,
    ok: false,
    status: Number.isInteger(err?.status) ? err.status : null,
    error_type: String(err?.error?.error?.type || err?.error?.type || err?.name || 'Error').slice(0, 60),
    error_message: trim(err?.message),
    latency_ms: Math.max(0, now() - started),
    input_tokens: null,
    output_tokens: null,
  };
}

/** Buffers rows and writes them with insert(rows). insert may reject; the batch is then dropped. */
function createRecorder({ insert, now = Date.now, maxBuffer = 500, batch = 50, log = () => {} }) {
  let buffer = [];
  let flushing = null;
  async function flush() {
    if (flushing) return flushing;
    if (buffer.length === 0) return;
    const rows = buffer.splice(0, 200);
    flushing = (async () => {
      try { await insert(rows); } catch (e) { log(`llm_calls write failed (${rows.length} rows dropped): ${trim(e?.message)}`); }
    })().finally(() => { flushing = null; });
    return flushing;
  }
  function record(row) {
    buffer.push(row);
    if (buffer.length > maxBuffer) buffer.splice(0, buffer.length - maxBuffer); // oldest rows go first
    if (buffer.length >= batch) flush();
  }
  return { record, flush, pending: () => buffer.length, now };
}

/**
 * Wraps client.messages.create so each call is recorded. The SDK's own promise is returned untouched (helpers such as
 * withResponse keep working); the recording is a side branch that handles both outcomes, so it can never surface as an
 * unhandled rejection or change what the caller sees. Returns the unwrapped create, used by probes.
 */
function instrument(client, recorder) {
  const messages = client.messages;
  const original = messages.create.bind(messages);
  messages.create = function create(params, ...rest) {
    const started = recorder.now();
    let out;
    try {
      out = original(params, ...rest);
    } catch (err) {
      recorder.record(failRow({ params, err, started, now: recorder.now, source: 'live' }));
      throw err;
    }
    if (out && typeof out.then === 'function') {
      out.then(
        (res) => recorder.record(okRow({ params, res, started, now: recorder.now, source: 'live' })),
        (err) => recorder.record(failRow({ params, err, started, now: recorder.now, source: 'live' })),
      );
    }
    return out;
  };
  return { original };
}

/** One tiny real request, recorded as source 'probe'. Returns the row. */
async function probeOnce({ original, recorder, model }) {
  const params = { model, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] };
  const started = recorder.now();
  let row;
  try {
    const res = await original(params);
    row = okRow({ params, res, started, now: recorder.now, source: 'probe' });
  } catch (err) {
    row = failRow({ params, err, started, now: recorder.now, source: 'probe' });
  }
  recorder.record(row);
  await recorder.flush();
  return row;
}

let singleton = null;

/** Attach to the app's Anthropic client once. Safe to call again. */
function attach(client, { supabaseAdmin, log = () => {}, model = 'claude-haiku-4-5-20251001' } = {}) {
  if (singleton) return singleton;
  const recorder = createRecorder({
    insert: async (rows) => { const { error } = await supabaseAdmin.from('llm_calls').insert(rows); if (error) throw new Error(error.message); },
    log,
  });
  const { original } = instrument(client, recorder);
  const timer = setInterval(() => recorder.flush(), 10_000); timer.unref?.();
  singleton = { recorder, probe: () => probeOnce({ original, recorder, model }), timer, probeTimer: null };
  return singleton;
}

/** Periodic live probe (default every 10 minutes; LLM_PROBE_INTERVAL_MIN=0 turns it off). */
function startProbe({ minutes = Number(process.env.LLM_PROBE_INTERVAL_MIN ?? 10), log = () => {} } = {}) {
  if (!singleton || !(minutes > 0) || singleton.probeTimer) return;
  const run = () => singleton.probe().catch((e) => log(`llm probe failed to run: ${trim(e?.message)}`));
  const first = setTimeout(run, 60_000); first.unref?.();
  singleton.probeTimer = setInterval(run, minutes * 60_000); singleton.probeTimer.unref?.();
}

module.exports = { attach, startProbe, createRecorder, instrument, probeOnce, okRow, failRow, getMonitor: () => singleton };

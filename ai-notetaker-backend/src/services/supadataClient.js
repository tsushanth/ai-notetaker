/**
 * The calls we make to Supadata (https://docs.supadata.ai). Every URL sent is built here from a YouTube video id, so a
 * user-supplied address never reaches the vendor (in generate mode it would transcribe any public file at our cost).
 * Credits: native transcript 1, transcript unavailable (206) 1, metadata 1, generated 2 per video minute, balance and
 * job polling free.
 */
const BASE_URL = 'https://api.supadata.ai/v1';
const NATIVE_TIMEOUT_MS = 45_000;
const GENERATE_TIMEOUT_MS = 240_000; // generating a 14 minute video took 90 s just to answer with a job id

class SupadataError extends Error {
  /** `billed`: credits the answer says were charged; 0 for a refused request; null when unknown (timeout). */
  constructor(code, detail, { status = null, billed = null } = {}) {
    super(`Supadata ${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'SupadataError';
    this.code = code;
    this.status = status;
    this.billed = billed;
  }
}

const asText = (content) => (Array.isArray(content)
  ? content.map((s) => (typeof s === 'string' ? s : (s.text || s.content || ''))).join(' ')
  : String(content || ''));

const videoUrlFor = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

function createSupadataClient({ apiKey = process.env.SUPADATA_API_KEY, fetchImpl = (...a) => fetch(...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  async function get(path, timeoutMs) {
    if (!apiKey) throw new SupadataError('not-configured', 'SUPADATA_API_KEY is not set', { billed: 0 });
    let response;
    try {
      response = await fetchImpl(`${BASE_URL}${path}`, { headers: { 'x-api-key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new SupadataError(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'network', error.name);
    }
    const data = await response.json().catch(() => null);
    const header = response.headers?.get?.('x-billable-requests');
    const billed = header === null || header === undefined || header === '' ? null : Number(header);
    if (response.status === 206 || data?.error === 'transcript-unavailable') {
      throw new SupadataError('transcript-unavailable', null, { status: response.status, billed: billed ?? 1 });
    }
    if (!response.ok) {
      // A refused request (4xx) is not charged; after a server error it is not known.
      const refused = response.status < 500 ? 0 : null;
      throw new SupadataError(typeof data?.error === 'string' ? data.error : 'http-error', `HTTP ${response.status}`, { status: response.status, billed: billed ?? refused });
    }
    if (!data) throw new SupadataError('bad-response', `HTTP ${response.status}`, { status: response.status, billed });
    return { status: response.status, data, billed };
  }

  return {
    /** mode 'native' (existing captions) or 'generate' (speech to text). Resolves { content, lang, billed } or { jobId, billed }. */
    async transcript(videoId, mode) {
      const params = new URLSearchParams({ url: videoUrlFor(videoId), text: 'true', mode });
      const { status, data, billed } = await get(`/transcript?${params}`, mode === 'generate' ? GENERATE_TIMEOUT_MS : NATIVE_TIMEOUT_MS);
      if (status === 202 || data.jobId) return { jobId: String(data.jobId), billed };
      return { content: asText(data.content), lang: data.lang || null, billed };
    },
    /** Waits for an asynchronous transcript. Resolves { content, lang }. */
    async pollJob(jobId, { intervalMs = 3000, timeoutMs = 10 * 60_000 } = {}) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        // The job has already been paid for, whatever happens to a status request.
        const { data } = await get(`/transcript/${encodeURIComponent(jobId)}`, 20_000).catch((e) => { e.billed = null; throw e; });
        if (data.status === 'completed') return { content: asText(data.result?.content ?? data.content), lang: data.result?.lang || data.lang || null };
        if (data.status === 'failed') throw new SupadataError(data.error?.error || 'job-failed', 'job failed');
        if (Date.now() + intervalMs > until) throw new SupadataError('job-timeout', 'job still running');
        await sleep(intervalMs);
      }
    },
    /** { type, durationSeconds }. Costs 1 credit. */
    async metadata(videoId) {
      const { data } = await get(`/metadata?${new URLSearchParams({ url: videoUrlFor(videoId) })}`, 20_000);
      return { type: data.type, durationSeconds: Number(data.media?.duration) };
    },
    /** { plan, used, max } for the current billing period. Free. */
    async balance() {
      const { data } = await get('/me', 15_000);
      return { plan: data.plan, used: Number(data.usedCredits), max: Number(data.maxCredits) };
    },
  };
}

module.exports = { createSupadataClient, SupadataError, videoUrlFor };

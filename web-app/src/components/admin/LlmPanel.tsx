'use client';

import { useState } from 'react';
import type { Level, LlmHealth } from './types';
import { Dot, Section, Stat, ago, ms, num, pct } from './ui';

const LEVEL: Record<LlmHealth['status'], Level> = { ok: 'ok', degraded: 'warn', down: 'down', unknown: 'off' };
const WORDS: Record<LlmHealth['status'], string> = { ok: 'Working', degraded: 'Degraded', down: 'Down', unknown: 'No data yet' };

// Claude is what every AI feature runs on, so its health sits next to the product numbers. Data is real traffic recorded by the
// backend (never prompts or answers) plus a tiny live probe every few minutes.
export default function LlmPanel({ llm, token, apiBase, onChanged }: { llm: LlmHealth; token: string; apiBase: string; onChanged: () => void }) {
  const [probe, setProbe] = useState<string>('');
  const [probing, setProbing] = useState(false);
  const level = LEVEL[llm.status];
  const max = Math.max(1, ...llm.series.map((b) => b.ok + b.failed));

  async function runProbe() {
    setProbing(true); setProbe('');
    try {
      const r = await fetch(`${apiBase}/api/admin/llm-probe`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) setProbe(`Probe could not run (HTTP ${r.status}).`);
      else setProbe(j.data.ok ? `Claude answered in ${ms(j.data.latencyMs)}.` : `Claude failed: ${j.data.status ?? 'no response'} ${j.data.errorType ?? ''}`.trim());
      onChanged();
    } catch { setProbe('Probe could not run (network error).'); } finally { setProbing(false); }
  }

  return (
    <Section title="LLM health (Claude)" hint={`Last ${llm.hours < 48 ? `${llm.hours} hours` : `${Math.round(llm.hours / 24)} days`}`}>
      <div className="card !p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2.5 text-[15px]"><Dot level={level} /><b>{WORDS[llm.status]}</b><span className="text-[var(--text-secondary)] text-sm">{llm.statusReason}</span></p>
        <div className="flex items-center gap-3">
          {probe && <span className="text-xs text-[var(--text-secondary)]" role="status">{probe}</span>}
          <button onClick={runProbe} disabled={probing} className="btn-secondary !py-1.5 !px-3 text-sm">{probing ? 'Checking...' : 'Run a live check'}</button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Success rate" value={pct(llm.totals.successRate)} tone={llm.totals.successRate != null && llm.totals.successRate < 0.9 ? 'warn' : undefined} hint={`${num(llm.totals.failed)} failed of ${num(llm.totals.calls)}`} />
        <Stat label="Calls" value={num(llm.totals.live)} hint={`+ ${num(llm.totals.probes)} health probes`} />
        <Stat label="Typical speed" value={ms(llm.latency.p50)} hint="median" />
        <Stat label="Slow end" value={ms(llm.latency.p95)} tone={llm.latency.p95 != null && llm.latency.p95 > 30_000 ? 'warn' : undefined} hint={`95th percentile, max ${ms(llm.latency.max)}`} />
        <Stat label="Estimated cost" value={`$${llm.tokens.estCostUsd.toFixed(2)}`} hint={`${num(llm.tokens.input)} in, ${num(llm.tokens.output)} out tokens`} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="card !p-4">
          <h3 className="text-sm font-medium">Calls over time</h3>
          {llm.series.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">No calls recorded in this range yet.</p> : (
            <>
              <div className="mt-3 flex h-20 items-end gap-[2px]" role="img" aria-label="LLM calls per period, failures in red">
                {llm.series.map((b) => (
                  <div key={b.ts} title={`${b.ts.slice(0, 13).replace('T', ' ')}: ${b.ok} ok, ${b.failed} failed`} className="flex flex-1 flex-col justify-end overflow-hidden rounded-sm" style={{ height: `${Math.max(6, ((b.ok + b.failed) / max) * 100)}%` }}>
                    {b.failed > 0 && <div style={{ flex: b.failed, background: 'var(--accent-red)' }} />}
                    <div style={{ flex: b.ok || 0.0001, background: 'var(--accent-purple)' }} />
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">Purple succeeded, red failed.</p>
            </>
          )}
        </div>
        <div className="card !p-4">
          <h3 className="text-sm font-medium">Errors</h3>
          {llm.errors.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">No errors in this range.</p> : (
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-xs text-[var(--text-muted)]"><th className="pb-1 font-normal">What</th><th className="pb-1 font-normal text-right">Count</th><th className="pb-1 font-normal text-right">Last</th></tr></thead>
              <tbody>{llm.errors.slice(0, 6).map((e) => (
                <tr key={`${e.status}-${e.error_type}`} className="border-t border-[var(--border)]"><td className="py-1.5">{e.status ?? 'no response'} {e.error_type}</td><td className="py-1.5 text-right tabular-nums">{e.count}</td><td className="py-1.5 text-right text-[var(--text-secondary)]">{ago(e.lastTs)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="card !p-4">
          <h3 className="text-sm font-medium">By model</h3>
          {llm.byModel.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">No calls yet.</p> : (
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-xs text-[var(--text-muted)]"><th className="pb-1 font-normal">Model</th><th className="pb-1 font-normal text-right">Calls</th><th className="pb-1 font-normal text-right">Failed</th><th className="pb-1 font-normal text-right">Median</th></tr></thead>
              <tbody>{llm.byModel.map((m) => (
                <tr key={m.model} className="border-t border-[var(--border)]"><td className="py-1.5 break-all">{m.model}</td><td className="py-1.5 text-right tabular-nums">{num(m.calls)}</td><td className="py-1.5 text-right tabular-nums">{num(m.failed)}</td><td className="py-1.5 text-right tabular-nums">{ms(m.p50)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className="card !p-4 text-sm">
          <h3 className="text-sm font-medium">Latest</h3>
          <dl className="mt-3 space-y-1.5">
            <div className="flex justify-between gap-3"><dt className="text-[var(--text-secondary)]">Last success</dt><dd>{llm.lastSuccess ? `${ago(llm.lastSuccess.ts)} (${ms(llm.lastSuccess.latency_ms)})` : 'none in range'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[var(--text-secondary)]">Last failure</dt><dd className="text-right">{llm.lastFailure ? `${ago(llm.lastFailure.ts)}: ${llm.lastFailure.status ?? 'no response'} ${llm.lastFailure.error_type ?? ''}` : 'none in range'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[var(--text-secondary)]">Last health probe</dt><dd>{llm.lastProbe ? `${ago(llm.lastProbe.ts)}, ${llm.lastProbe.ok ? 'ok' : 'failed'}` : 'none in range'}</dd></div>
          </dl>
          {llm.lastFailure?.error_message && <p className="mt-3 break-words rounded bg-[var(--surface-variant)] p-2 text-xs text-[var(--text-secondary)]">{llm.lastFailure.error_message}</p>}
        </div>
      </div>
    </Section>
  );
}

'use client';

import { Section, ago } from './ui';

type Row = Record<string, any>;
export interface Reporter { health: Row[]; latest: Row[]; groups: Row[]; recent: Row[]; byKind: Row[]; usage: Row[] }

const th = 'py-1.5 pr-3 text-left text-xs font-normal text-[var(--text-muted)]';
const td = 'py-1.5 pr-3 align-top border-t border-[var(--border)]';

// Crash and error reports from the apps plus uptime probes of the public endpoints, from the central reporter Worker.
export default function ReporterPanel({ d }: { d: Reporter }) {
  const days = Array.from(new Set(d.usage.map((u) => u.day))).sort().reverse().slice(0, 14);
  const metrics = Array.from(new Set(d.usage.map((u) => u.metric))).sort();
  return (
    <>
      <Section title="Uptime probes" hint="Every 5 minutes, from the reporter">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {d.latest.length === 0 && <p className="text-sm text-[var(--text-muted)]">No probes yet.</p>}
          {d.latest.map((l) => {
            const s = d.health.find((h) => h.target === l.target);
            const up = s ? Math.round((100 * s.ok) / s.n) : 0;
            const color = !l.ok ? '#ef4444' : up < 99 ? '#f59e0b' : '#22c55e';
            return (
              <div key={l.target} className="card !p-4 text-sm">
                <p className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} /><b className="break-all">{l.target}</b></p>
                <p className="mt-1 text-[var(--text-secondary)]">{l.ok ? 'up' : `DOWN (${l.status || 'no response'})`} &middot; {l.latency_ms} ms &middot; {ago(l.ts)}</p>
                <p className="text-[var(--text-secondary)]">{up}% uptime &middot; avg {s?.avg_ms ?? '-'} ms &middot; max {s?.max_ms ?? '-'} ms</p>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={`App errors (${d.byKind.map((k) => `${k.n} ${k.kind}`).join(', ') || 'none'})`} hint="Reported by the iOS, Android and web apps">
        <div className="card !p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Kind</th><th className={th}>Where</th><th className={th}>Message</th><th className={th}>Count</th><th className={th}>Last</th><th className={th}>Versions</th></tr></thead>
            <tbody>{d.groups.map((g) => (
              <tr key={g.fingerprint}><td className={td}>{g.kind}</td><td className={td}>{g.flow}<div className="text-xs text-[var(--text-muted)]">{g.platforms}</div></td>
                <td className={`${td} max-w-[480px] break-words`}>{String(g.message).split('\n')[0].slice(0, 160)}</td>
                <td className={td}>{g.n}</td><td className={td}>{ago(g.last_ts)}</td><td className={td}>{g.versions}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Section>

      <Section title="Recent events">
        <div className="card !p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={th}>When</th><th className={th}>Kind</th><th className={th}>Where</th><th className={th}>Message</th></tr></thead>
            <tbody>{d.recent.map((e) => (
              <tr key={e.id}><td className={td}>{ago(e.ts)}</td><td className={td}>{e.kind}</td><td className={td}>{e.flow}<div className="text-xs text-[var(--text-muted)]">{e.platform} {e.version}</div></td>
                <td className={`${td} max-w-[520px] break-words`}><details><summary className="cursor-pointer">{String(e.message).split('\n')[0].slice(0, 140)}</summary>
                  <pre className="whitespace-pre-wrap text-xs">{e.message}{e.stack ? `\n\n${e.stack}` : ''}</pre></details></td></tr>
            ))}</tbody>
          </table>
        </div>
      </Section>

      {metrics.length > 0 && (
        <Section title="Reported usage counters">
          <div className="card !p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className={th}>Metric</th>{days.map((x) => <th key={x} className={th}>{x.slice(5)}</th>)}</tr></thead>
              <tbody>{metrics.map((m) => (
                <tr key={m}><td className={td}>{m}</td>{days.map((x) => <td key={x} className={td}>{d.usage.find((u) => u.metric === m && u.day === x)?.value ?? ''}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}

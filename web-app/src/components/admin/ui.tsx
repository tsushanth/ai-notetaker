'use client';

import type { ReactNode } from 'react';
import type { Day, Level } from './types';

export const DOT: Record<Level, string> = { ok: 'bg-[#22c55e]', warn: 'bg-[#f59e0b]', down: 'bg-[#ef4444]', off: 'bg-[#6b7280]' };
export const LABEL: Record<Level, string> = { ok: 'Healthy', warn: 'Degraded', down: 'Problem', off: 'No data' };

export const ago = (iso?: string | number | null) => {
  if (iso == null) return 'never';
  const s = (Date.now() - (typeof iso === 'number' ? iso : Date.parse(iso))) / 1000;
  return s < 90 ? `${Math.max(0, Math.round(s))}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
export const num = (n: number | null | undefined) => (n == null ? '-' : n.toLocaleString('en-US'));
export const ms = (n: number | null | undefined) => (n == null ? '-' : n >= 10_000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
export const pct = (r: number | null | undefined) => (r == null ? '-' : `${(r * 100).toFixed(r === 1 || r === 0 ? 0 : 1)}%`);

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {hint && <p className="text-xs text-[var(--text-muted)]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: Level }) {
  return (
    <div className="card !p-4">
      <p className="text-[13px] text-[var(--text-secondary)]">{label}</p>
      <p className="mt-1 text-2xl tabular-nums tracking-tight" style={tone === 'down' ? { color: 'var(--accent-red)' } : tone === 'warn' ? { color: '#f59e0b' } : undefined}>{value}</p>
      {hint && <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

export function Dot({ level }: { level: Level }) {
  return <><span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[level]}`} aria-hidden /><span className="sr-only">{LABEL[level]}</span></>;
}

/** One bar per day. Zero days stay visible as a faint stub so gaps are obvious. */
export function Bars({ label, data }: { label: string; data: Day[] }) {
  const max = Math.max(1, ...data.map((x) => x.v));
  const total = data.reduce((a, x) => a + x.v, 0);
  return (
    <div className="card !p-4">
      <div className="flex items-baseline justify-between"><h3 className="text-sm font-medium">{label}</h3><span className="text-xs text-[var(--text-muted)] tabular-nums">{num(total)} in range</span></div>
      <div className="mt-3 flex h-20 items-end gap-[2px]" role="img" aria-label={`${label} per day`}>
        {data.map((x) => (
          <div key={x.d} title={`${x.d}: ${x.v}`} className="flex-1 rounded-sm bg-[var(--accent-purple)]" style={{ height: `${Math.max(x.v ? 5 : 2, (x.v / max) * 100)}%`, opacity: x.v ? 1 : 0.18 }} />
        ))}
      </div>
      {data.length > 0 && <div className="mt-1 flex justify-between text-[11px] text-[var(--text-muted)]"><span>{data[0].d.slice(5)}</span><span>{data[data.length - 1].d.slice(5)}</span></div>}
    </div>
  );
}

/** Horizontal bars for a short list of named counts. */
export function Ranked({ title, rows }: { title: string; rows: { name: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="card !p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">Nothing in this range.</p> : (
        <ul className="mt-3 space-y-2">
          {rows.slice(0, 8).map((r) => (
            <li key={r.name} className="text-sm">
              <div className="flex justify-between"><span>{r.name}</span><span className="tabular-nums text-[var(--text-secondary)]">{num(r.n)}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-[var(--surface-variant)]"><div className="h-1.5 rounded-full bg-[var(--accent-purple)]" style={{ width: `${(r.n / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

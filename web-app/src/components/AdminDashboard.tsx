'use client';

// Internal admin: is everything up (including the LLM provider), who is using ScribeAI, and what is going wrong.
// Product and LLM numbers come from the backend (/api/admin/overview, admin accounts only). Crash reports and uptime probes come
// from this site's own /api/admin/overview, which proxies the central reporter Worker with a server-side secret.
import { useCallback, useEffect, useRef, useState } from 'react';
import { handleSessionExpired } from '@/lib/sessionExpiry';
import type { Level, Overview } from './admin/types';
import ProductPanel from './admin/ProductPanel';
import LlmPanel from './admin/LlmPanel';
import ReporterPanel, { type Reporter } from './admin/ReporterPanel';
import LlmSpendPanel from './admin/LlmSpendPanel';
import { DOT, Dot, Section, ago } from './admin/ui';

const API_BASE = 'https://ai-notetaker-backend.fly.dev';
const RANGES = [{ label: '24 hours', hours: 24, days: 7 }, { label: '7 days', hours: 168, days: 7 }, { label: '30 days', hours: 720, days: 30 }];
const RANK: Record<Level, number> = { off: 0, ok: 1, warn: 2, down: 3 };
const NOT_ADMIN = 'This account is not on the admin list.';

export default function AdminDashboard({ token }: { token: string }) {
  const [range, setRange] = useState(RANGES[0]);
  const [ov, setOv] = useState<Overview | null>(null);
  const [ovErr, setOvErr] = useState('');
  const [rep, setRep] = useState<Reporter | null>(null);
  const [repErr, setRepErr] = useState('');
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setBusy(true);
    const auth = { Authorization: `Bearer ${token}` };
    const [a, b] = await Promise.allSettled([
      fetch(`${API_BASE}/api/admin/overview?days=${range.days}&hours=${range.hours}`, { headers: auth, cache: 'no-store' }),
      fetch(`/api/admin/overview?hours=${range.hours}`, { headers: auth, cache: 'no-store' }),
    ]);
    if (mine !== seq.current) return; // a newer refresh is already running

    if (a.status === 'fulfilled') {
      const r = a.value;
      if (r.status === 401) return handleSessionExpired();
      if (r.status === 404) { setOv(null); setOvErr(NOT_ADMIN); }
      else if (!r.ok) setOvErr(`Product and LLM data could not be loaded (HTTP ${r.status}).`);
      else { const j = await r.json().catch(() => null); if (j?.success) { setOv(j.data); setOvErr(''); } else setOvErr('Product and LLM data came back in an unexpected shape.'); }
    } else setOvErr('Could not reach the backend.');

    if (b.status === 'fulfilled') {
      const r = b.value;
      if (r.status === 401) return handleSessionExpired();
      if (!r.ok) setRepErr(r.status === 404 ? NOT_ADMIN : `Error reports could not be loaded (HTTP ${r.status}).`);
      else { setRep(await r.json().catch(() => null)); setRepErr(''); }
    } else setRepErr('Could not load error reports.');

    setLoadedAt(Date.now()); setBusy(false);
  }, [token, range]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { // keep the status fresh while the tab is open and visible
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const checks = ov?.checks ?? [];
  const worst: Level = checks.reduce<Level>((w, c) => (RANK[c.level] > RANK[w] ? c.level : w), 'off');
  const headline = worst === 'down' ? 'A system has a problem' : worst === 'warn' ? 'Some systems are degraded' : worst === 'ok' ? 'All systems healthy' : 'No health data yet';

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 text-[15px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[var(--text-muted)]">Internal</p>
          <h1 className="text-xl font-medium">ScribeAI admin</h1>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Range" value={range.label} onChange={(e) => setRange(RANGES.find((r) => r.label === e.target.value) || RANGES[0])} className="rounded-lg border border-[var(--border)] bg-[var(--card-background)] px-2.5 py-1.5 text-sm">
            {RANGES.map((r) => <option key={r.label}>{r.label}</option>)}
          </select>
          <button onClick={load} disabled={busy} className="btn-secondary !py-1.5 !px-3 text-sm">{busy ? 'Refreshing...' : 'Refresh'}</button>
        </div>
      </div>
      {loadedAt && <p className="mt-1 text-xs text-[var(--text-muted)]">Updated {ago(loadedAt)}. Refreshes every minute while this tab is open.</p>}

      {ovErr && <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--card-background)] p-3 text-sm text-[var(--accent-red)]" role="alert">{ovErr}</p>}
      {!ov && !ovErr && <p className="mt-6 text-[var(--text-muted)]">Loading...</p>}

      {ov && (
        <>
          <div className="card !p-4 mt-5">
            <p className="flex items-center gap-2.5 text-[15px]"><span className={`h-3 w-3 rounded-full ${DOT[worst]}`} aria-hidden /><b>{headline}</b></p>
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {checks.map((c) => (
                <li key={c.name} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="flex items-center gap-2.5"><Dot level={c.level} />{c.name}</span>
                  <span className="text-right text-[var(--text-secondary)]">{c.detail}{c.ms !== undefined && c.level !== 'off' ? ` · ${c.ms} ms` : ''}</span>
                </li>
              ))}
            </ul>
          </div>

          {ov.attention.length > 0 && (
            <Section title="Needs attention">
              <ul className="space-y-2">
                {ov.attention.map((a) => (
                  <li key={a.text} className="card !p-3 flex items-start gap-2.5 text-sm"><Dot level={a.level === 'down' ? 'down' : 'warn'} /><span>{a.text}</span></li>
                ))}
              </ul>
            </Section>
          )}

          {ov.llm ? <LlmPanel llm={ov.llm} token={token} apiBase={API_BASE} onChanged={load} /> : <Section title="LLM health (Claude)"><p className="text-sm text-[var(--text-muted)]">Health data is unavailable. Check that the llm_calls table exists and the backend is running the monitor.</p></Section>}
          {ov.stats ? <ProductPanel s={ov.stats} /> : <Section title="People and usage"><p className="text-sm text-[var(--text-muted)]">Product numbers could not be loaded.</p></Section>}
        </>
      )}

      {repErr && <p className="mt-6 text-sm text-[var(--accent-red)]" role="alert">{repErr}</p>}
      {rep?.llm && <div className="mt-2"><LlmSpendPanel llm={rep.llm} /></div>}
      {rep && <ReporterPanel d={rep} />}
    </div>
  );
}

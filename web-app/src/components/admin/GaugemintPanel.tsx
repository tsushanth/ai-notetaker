'use client';

// "Website visits (Gaugemint)" card of /admin: landing-page visits of scribeai.online from Gaugemint, our own cookieless analytics.
// Data comes from /api/admin/gaugemint, which repeats the admin check and calls Gaugemint with a server-side read key. Nothing here
// talks to Gaugemint, and a failure here is contained: the rest of the dashboard does not depend on this card.
import { useEffect, useState } from 'react';
import {
  GAUGEMINT_PERIODS, fmtDuration, isGaugemintResult,
  type GaugemintPeriod, type GaugemintResult, type GaugemintRow,
} from '@/lib/gaugemintTypes';
import { Ranked, Section, Stat, num } from './ui';

const PERIOD_LABEL: Record<GaugemintPeriod, string> = { '7d': '7 days', '30d': '30 days', '12mo': '12 months' };

function regionName(code: string): string {
  try {
    return /^[A-Za-z]{2}$/.test(code) ? new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) || code : code;
  } catch { return code; }
}

const asRanked = (rows: GaugemintRow[], label: (n: string) => string = (n) => n) => rows.map((r) => ({ name: label(r.name), n: r.visitors }));

export default function GaugemintPanel({ token }: { token: string }) {
  const [period, setPeriod] = useState<GaugemintPeriod>('30d');
  const [res, setRes] = useState<GaugemintResult | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setRes(null);
    setErr('');
    (async () => {
      try {
        const r = await fetch(`/api/admin/gaugemint?period=${period}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 404) throw new Error('This account is not on the admin list.');
        const j: unknown = await r.json().catch(() => null); // a Gaugemint error also arrives as JSON ({ ok:false, error }) with a 5xx status
        if (!isGaugemintResult(j)) throw new Error(`Unexpected response (HTTP ${r.status}).`);
        if (!cancelled) setRes(j);
      } catch (e: any) { if (!cancelled) setErr(e?.message || 'failed to load'); }
    })();
    return () => { cancelled = true; };
  }, [period, token]);

  const picker = (
    <select aria-label="Website visits period" value={period} onChange={(e) => setPeriod(e.target.value as GaugemintPeriod)} className="rounded-lg border border-[var(--border)] bg-[var(--card-background)] px-2.5 py-1 text-xs">
      {GAUGEMINT_PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
    </select>
  );
  const title = 'Website visits (Gaugemint)';
  const scope = 'Landing-page visits only: the tracking tag is on the public marketing pages, not inside the app.';

  if (err) return <Section title={title} hint={scope}><div className="flex items-center gap-3">{picker}<p className="text-sm text-[var(--accent-red)]" role="alert">Website visits could not be loaded: {err}</p></div></Section>;
  if (!res) return <Section title={title} hint={scope}><div className="flex items-center gap-3">{picker}<p className="text-sm text-[var(--text-muted)]">Loading...</p></div></Section>;

  if (!res.ok) {
    const off = res.error.kind === 'not_configured';
    return (
      <Section title={title} hint={scope}>
        <div className="mb-3">{picker}</div>
        <div className="card !p-4 text-sm" role="alert">
          <p className="font-medium">{off ? 'Website analytics is not configured' : 'Website analytics is unavailable'}</p>
          <p className="mt-1 text-[var(--text-secondary)]">{res.error.message}</p>
          {off && <p className="mt-1 text-xs text-[var(--text-muted)]">The rest of the admin is not affected. Set the Fly secret GAUGEMINT_READ_KEY (a read-only Gaugemint key for this site) to turn it on.</p>}
        </div>
      </Section>
    );
  }

  const { stats } = res;
  const t = stats.totals;
  const unit = stats.granularity === 'month' ? 'month' : 'day';
  const peak = Math.max(0, ...stats.series.map((p) => p.visitors));
  const max = Math.max(1, peak);
  const first = stats.series[0]?.day, last = stats.series[stats.series.length - 1]?.day;

  return (
    <Section title={title} hint={scope}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {picker}
        <p className="text-xs text-[var(--text-muted)]">{stats.site}, last {PERIOD_LABEL[stats.period]}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Visitors" value={num(t.visitors)} />
        <Stat label="Pageviews" value={num(t.pageviews)} />
        <Stat label="Visits" value={num(t.visits)} />
        <Stat label="Bounce rate" value={`${Math.round(t.bounce_rate)}%`} />
        <Stat label="Visit duration" value={fmtDuration(t.visit_duration)} />
      </div>

      <div className="card !p-4 mt-3">
        <div className="flex items-baseline justify-between"><h3 className="text-sm font-medium">Visitors per {unit}</h3><span className="text-xs text-[var(--text-muted)] tabular-nums">peak {num(peak)}</span></div>
        {stats.series.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">No data in this period.</p> : (
          <>
            <div className="mt-3 flex h-20 items-end gap-[2px]" role="img" aria-label={`Visitors per ${unit}, ${stats.series.length} bars`}>
              {stats.series.map((p) => (
                <div key={p.day} title={`${p.day}: ${num(p.visitors)} visitors`} className="flex-1 rounded-sm bg-[var(--accent-purple)]" style={{ height: `${Math.max(p.visitors ? 5 : 2, (p.visitors / max) * 100)}%`, opacity: p.visitors ? 1 : 0.18 }} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-[var(--text-muted)]"><span>{first}</span><span>{last}</span></div>
          </>
        )}
        {stats.period === '12mo' && <p className="mt-2 text-[11px] text-[var(--text-muted)]">One bar per month: the sum of daily visitors (a visitor code rotates daily, so a returning person counts once per day). Gaugemint only returns what it still stores.</p>}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="card !p-4">
          <h3 className="text-sm font-medium">Top pages</h3>
          {stats.pages.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">Nothing in this range.</p> : (
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-xs text-[var(--text-muted)]"><th className="font-normal">Page</th><th className="text-right font-normal">Visitors</th><th className="text-right font-normal">Views</th></tr></thead>
              <tbody>{stats.pages.map((r) => (
                <tr key={r.name} className="border-t border-[var(--border)]"><td className="break-all py-1.5 pr-2">{r.name}</td><td className="text-right tabular-nums">{num(r.visitors)}</td><td className="text-right tabular-nums text-[var(--text-secondary)]">{num(r.pageviews)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <Ranked title="Top sources" rows={asRanked(stats.sources)} />
        <Ranked title="Top countries" rows={asRanked(stats.countries, regionName)} />
        <Ranked title="Devices" rows={asRanked(stats.devices)} />
      </div>
      <p className="mt-3 text-xs text-[var(--text-muted)]">From Gaugemint, updated {new Date(res.fetchedAt).toLocaleTimeString()} (cached up to 60 s). Visitors respecting Do Not Track or Global Privacy Control are not counted.</p>
    </Section>
  );
}

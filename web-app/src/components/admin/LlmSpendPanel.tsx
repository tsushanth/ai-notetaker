'use client';

// Claude API spend across the apps that report to the central Worker (POST /v1/llm). Drop-in for any React admin page:
// no dependencies, inline styles that follow the surrounding text colour, works with React 18 and 19.
// Feed it the `llm` block of this site's /api/admin/overview response. Counts only what apps report; the Anthropic Console
// shows the organisation total. Costs are token counts at list prices.
import type { CSSProperties } from 'react';

export interface LlmSummary {
  month: string; asOf: string;
  total: { cost: number; calls: number; errors: number; input_tokens: number; output_tokens: number };
  limitUsd: number | null; pctOfLimit: number | null;
  projectedMonthEnd: number; avgPerDay7: number; daysLeft: number; projectedHitLimitOn: string | null;
  byApp: { app: string; cost: number; calls: number; errors: number; input_tokens: number; output_tokens: number }[];
  daily: { day: string; app: string; cost: number }[];
  byModel: { model: string; cost: number; calls: number; input_tokens: number; output_tokens: number }[];
  byFeature: { app: string; feature: string; cost: number; calls: number }[];
  scopeApp: string | null;
}

const usd = (n: number) => `$${n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)}`;
const tok = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n));
const COLORS = ['#6c63ff', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#a855f7'];
const box: CSSProperties = { border: '1px solid #8884', borderRadius: 8, padding: 12 };
const th: CSSProperties = { textAlign: 'left', padding: '6px 8px', opacity: 0.6, fontWeight: 500 };
const td: CSSProperties = { padding: '6px 8px', borderTop: '1px solid #8883', verticalAlign: 'top' };
const num: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const h2: CSSProperties = { fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em', opacity: 0.6, margin: '24px 0 8px' };

export default function LlmSpendPanel({ llm }: { llm: LlmSummary | null | undefined }) {
  if (!llm) return null;
  const apps = llm.byApp.map((a) => a.app);
  const color = (app: string) => COLORS[Math.max(0, apps.indexOf(app)) % COLORS.length];
  const days = Array.from(new Set(llm.daily.map((d) => d.day))).sort();
  const perDay = days.map((day) => ({ day, rows: llm.daily.filter((d) => d.day === day), total: llm.daily.filter((d) => d.day === day).reduce((a, r) => a + r.cost, 0) }));
  const maxDay = Math.max(0.01, ...perDay.map((d) => d.total));
  const pct = llm.pctOfLimit;
  const tone = pct == null ? undefined : pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#22c55e';
  return (
    <div>
      <h2 style={h2}>Claude API spend, {llm.month}</h2>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
          <div style={{ fontSize: 26, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{usd(llm.total.cost)}{llm.limitUsd ? <span style={{ fontSize: 15, opacity: 0.6, fontWeight: 400 }}> of {usd(llm.limitUsd)} limit{pct != null ? ` (${pct}%)` : ''}</span> : null}</div>
          <div style={{ opacity: 0.7, fontSize: 13 }}>{usd(llm.avgPerDay7)}/day over the last 7 days &middot; {llm.daysLeft} days left</div>
        </div>
        {llm.limitUsd ? (
          <div style={{ height: 8, borderRadius: 4, background: '#8883', marginTop: 8 }} role="img" aria-label={`${pct}% of the monthly limit used`}>
            <div style={{ height: 8, borderRadius: 4, width: `${Math.min(100, pct ?? 0)}%`, background: tone }} />
          </div>
        ) : null}
        <p style={{ margin: '8px 0 0', fontSize: 13, color: llm.projectedHitLimitOn ? '#ef4444' : undefined, opacity: llm.projectedHitLimitOn ? 1 : 0.7 }}>
          Projected month end {usd(llm.projectedMonthEnd)} at the current pace{llm.projectedHitLimitOn ? `. The limit would be reached around ${llm.projectedHitLimitOn}.` : llm.limitUsd ? ', under the limit.' : '.'}
        </p>
      </div>

      <h2 style={h2}>By app</h2>
      {llm.byApp.length === 0 ? <p style={{ opacity: 0.6 }}>No spend reported yet. Apps report once they run the LLM usage client.</p> : (
        <div style={{ ...box, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr><th style={th}>App</th><th style={{ ...th, textAlign: 'right' }}>Cost</th><th style={{ ...th, textAlign: 'right' }}>Share</th><th style={{ ...th, textAlign: 'right' }}>Calls</th><th style={{ ...th, textAlign: 'right' }}>Errors</th><th style={{ ...th, textAlign: 'right' }}>In</th><th style={{ ...th, textAlign: 'right' }}>Out</th></tr></thead>
            <tbody>{llm.byApp.map((a) => (
              <tr key={a.app} style={a.app === llm.scopeApp ? { background: '#8882' } : undefined}>
                <td style={td}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color(a.app), marginRight: 6 }} />{a.app}</td>
                <td style={num}>{usd(a.cost)}</td><td style={num}>{llm.total.cost ? Math.round((100 * a.cost) / llm.total.cost) : 0}%</td>
                <td style={num}>{a.calls.toLocaleString('en-US')}</td><td style={num}>{a.errors.toLocaleString('en-US')}</td><td style={num}>{tok(a.input_tokens)}</td><td style={num}>{tok(a.output_tokens)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      {perDay.length > 0 && (<>
        <h2 style={h2}>Daily, last 14 days</h2>
        <div style={box}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90 }} role="img" aria-label="Claude spend per day, stacked by app">
            {perDay.map((d) => (
              <div key={d.day} title={`${d.day}: ${usd(d.total)}`} style={{ flex: 1, height: `${Math.max(3, (d.total / maxDay) * 100)}%`, display: 'flex', flexDirection: 'column-reverse', borderRadius: 2, overflow: 'hidden' }}>
                {d.rows.map((r) => <div key={r.app} style={{ flex: r.cost, background: color(r.app) }} />)}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.6, marginTop: 4 }}><span>{days[0].slice(5)}</span><span>{days[days.length - 1].slice(5)}</span></div>
        </div>
      </>)}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, marginTop: 12 }}>
        <div style={{ ...box, overflowX: 'auto' }}>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>{llm.scopeApp ? `Models, ${llm.scopeApp}` : 'Models'}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}><tbody>
            {llm.byModel.length === 0 ? <tr><td style={td}>None yet.</td></tr> : llm.byModel.map((m) => <tr key={m.model}><td style={td}>{m.model}</td><td style={num}>{usd(m.cost)}</td><td style={num}>{m.calls.toLocaleString('en-US')} calls</td></tr>)}
          </tbody></table>
        </div>
        <div style={{ ...box, overflowX: 'auto' }}>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>{llm.scopeApp ? `Features, ${llm.scopeApp}` : 'Features'}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}><tbody>
            {llm.byFeature.length === 0 ? <tr><td style={td}>None yet.</td></tr> : llm.byFeature.slice(0, 12).map((f) => <tr key={`${f.app}/${f.feature}`}><td style={td}>{llm.scopeApp ? '' : `${f.app} / `}{f.feature || '(unlabelled)'}</td><td style={num}>{usd(f.cost)}</td><td style={num}>{f.calls.toLocaleString('en-US')} calls</td></tr>)}
          </tbody></table>
        </div>
      </div>
      <p style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>Counts only apps that report here, priced at list rates from token counts. The Anthropic Console shows the organisation total.</p>
    </div>
  );
}

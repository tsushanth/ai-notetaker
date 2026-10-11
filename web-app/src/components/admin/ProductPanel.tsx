'use client';

import type { Stats } from './types';
import { Bars, Ranked, Section, Stat, num } from './ui';

// Who is using ScribeAI and what they do. All numbers are aggregates; nothing here shows note text.
export default function ProductPanel({ s }: { s: Stats }) {
  const rec = s.recordings;
  return (
    <>
      <Section title="People" hint={`Last ${s.days} days unless noted`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Total accounts" value={num(s.users.total)} hint={`${num(s.users.new30d)} new in 30 days`} />
          <Stat label="New this week" value={num(s.users.new7d)} hint={`${num(s.users.new24h)} in the last 24 hours`} />
          <Stat label="Active, 7 days" value={num(s.active.d7)} hint={`${num(s.active.d1)} today, ${num(s.active.d30)} in 30 days`} />
          <Stat label="Paying now" value={num(s.subscriptions.activePaid)} hint={`${num(s.subscriptions.activeTrials)} on a trial`} />
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">Active means made a note, a recording or AI content in that period.</p>
      </Section>

      <Section title="Usage">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Notes" value={num(s.notes.window)} hint={`${num(s.notes.total)} all time`} />
          <Stat label="AI items generated" value={num(s.ai.window)} hint={`${num(s.ai.total)} all time`} />
          <Stat label="Audio transcribed" value={`${num(rec.hoursOfAudio)} h`} hint={`${num(rec.total)} recordings all time`} />
          <Stat label="Recording failures, 7 days" value={`${num(rec.failed7d)} of ${num(rec.last7d)}`} tone={rec.last7d >= 10 && rec.failedRate7d >= 0.25 ? 'warn' : undefined} hint={`${num(rec.failedTotal)} failed all time`} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Bars label="New accounts" data={s.users.signupsByDay} />
          <Bars label="Notes created" data={s.notes.byDay} />
          <Bars label="AI items generated" data={s.ai.byDay} />
          <Bars label="Recordings" data={rec.byDay} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Ranked title="Where notes come from" rows={s.notes.bySource} />
          <Ranked title="Which AI features get used" rows={s.ai.byType} />
        </div>
      </Section>

      <Section title="Activation funnel" hint="Distinct people, all time">
        <div className="card !p-4">
          <ul className="space-y-3">
            {s.funnel.map((f, i) => (
              <li key={f.label}>
                <div className="flex justify-between text-sm"><span>{f.label}</span><span className="tabular-nums text-[var(--text-secondary)]">{num(f.n)}{f.pct != null && i > 0 ? ` (${f.pct}%)` : ''}</span></div>
                <div className="mt-1 h-2 rounded-full bg-[var(--surface-variant)]"><div className="h-2 rounded-full bg-[var(--accent-purple)]" style={{ width: `${Math.max(f.n ? 1.5 : 0, f.pct ?? 0)}%` }} /></div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section title="Subscriptions" hint="From the subscriptions table (the tier on the users table is not maintained)">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Paying" value={num(s.subscriptions.activePaid)} />
          <Stat label="On a trial" value={num(s.subscriptions.activeTrials)} />
          <Stat label="Lapsed" value={num(s.subscriptions.expired)} />
          <Stat label="Started, 30 days" value={num(s.subscriptions.startedLast30d)} hint={s.subscriptions.byPlatform.map((p) => `${p.n} ${p.name}`).join(', ') || 'no active plans'} />
        </div>
      </Section>
    </>
  );
}

'use client';

import { Check, Loader2 } from 'lucide-react';

/**
 * Shows where a slow job is (upload, transcription, ...). Only pass steps the code can really observe:
 * `current` is the index of the step in progress, earlier steps are done.
 */
export default function ProcessingSteps({ steps, current, hint }: { steps: string[]; current: number; hint?: string }) {
  return (
    <div className="mt-6 text-left" role="status" aria-live="polite">
      <ol className="space-y-2">
        {steps.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} className="flex items-center gap-3">
              {done ? (
                <Check size={18} className="text-[var(--accent-green)]" />
              ) : active ? (
                <Loader2 size={18} className="animate-spin text-[var(--accent-purple)]" />
              ) : (
                <span className="w-[18px] h-[18px] rounded-full border border-[var(--border)]" />
              )}
              <span className={active ? 'font-medium' : done ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}>{label}</span>
            </li>
          );
        })}
      </ol>
      {hint && <p className="mt-3 text-sm text-[var(--text-secondary)]">{hint}</p>}
    </div>
  );
}

'use client';

import { Loader2, Sparkles, RotateCcw } from 'lucide-react';

/** AI summary at the top of the Notes tab: shows the saved summary, or a Generate button. */
export default function SummarySection({
  summary,
  isGenerating,
  error,
  onGenerate,
}: {
  summary: string | null;
  isGenerating: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  return (
    <section className="mb-6 p-4 rounded-lg border border-[var(--border)] bg-[var(--surface-variant)]" aria-label="AI summary">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles size={18} className="text-[var(--accent-purple)]" />
          Summary
        </h2>
        {summary && (
          <button
            onClick={onGenerate}
            disabled={isGenerating}
            className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Regenerate
          </button>
        )}
      </div>

      {summary ? (
        <p className="whitespace-pre-wrap text-[var(--text-primary)]">{summary}</p>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-[var(--text-secondary)] flex-1">Get the key points of this note in a short paragraph.</p>
          <button onClick={onGenerate} disabled={isGenerating} className="btn-primary flex items-center justify-center gap-2 disabled:opacity-50">
            {isGenerating ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Summarizing...
              </>
            ) : (
              'Generate summary'
            )}
          </button>
        </div>
      )}

      {/* A daily-limit message (HTTP 429) is plain information, not a paywall, so it is not styled as a failure. */}
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--text-secondary)]">
          {error}
        </p>
      )}
    </section>
  );
}

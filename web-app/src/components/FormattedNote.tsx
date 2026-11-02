'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

// Styled with the app's CSS variables. Raw HTML in the markdown is not rendered (react-markdown's default), and
// links keep react-markdown's default URL sanitising.
const components: Components = {
  h1: (p) => <h1 className="text-2xl font-bold mt-6 mb-3 first:mt-0" {...strip(p)} />,
  h2: (p) => <h2 className="text-xl font-semibold mt-6 mb-2 first:mt-0" {...strip(p)} />,
  h3: (p) => <h3 className="text-lg font-semibold mt-4 mb-2" {...strip(p)} />,
  h4: (p) => <h4 className="font-semibold mt-4 mb-1" {...strip(p)} />,
  p: (p) => <p className="mb-3 leading-relaxed" {...strip(p)} />,
  ul: (p) => <ul className="list-disc pl-6 mb-3 space-y-1" {...strip(p)} />,
  ol: (p) => <ol className="list-decimal pl-6 mb-3 space-y-1" {...strip(p)} />,
  blockquote: (p) => <blockquote className="border-l-4 border-[var(--accent-purple)] pl-4 my-3 text-[var(--text-secondary)]" {...strip(p)} />,
  a: (p) => <a className="text-[var(--accent-purple)] underline" target="_blank" rel="noopener noreferrer" {...strip(p)} />,
  hr: () => <hr className="my-6 border-[var(--border)]" />,
  code: (p) => <code className="px-1 py-0.5 rounded bg-[var(--surface-variant)] text-sm font-mono" {...strip(p)} />,
  pre: (p) => <pre className="p-3 mb-3 rounded-lg bg-[var(--surface-variant)] overflow-x-auto text-sm" {...strip(p)} />,
  table: (p) => (
    <div className="overflow-x-auto mb-4">
      <table className="min-w-full border-collapse text-sm" {...strip(p)} />
    </div>
  ),
  th: (p) => <th className="border border-[var(--border)] px-3 py-2 text-left font-semibold bg-[var(--surface-variant)]" {...strip(p)} />,
  td: (p) => <td className="border border-[var(--border)] px-3 py-2 align-top" {...strip(p)} />,
};

// react-markdown passes the hast `node` prop; do not spread it onto DOM elements.
function strip<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const rest = { ...props };
  delete rest.node;
  return rest;
}

/** Renders the backend's formatted markdown (headings, lists, tables, bold) like the Android FormattedNoteView. */
export default function FormattedNote({ markdown }: { markdown: string }) {
  return (
    <div className="text-[var(--text-primary)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

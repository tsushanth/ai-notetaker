'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FileText, Eye, Calendar, Loader2, AlertCircle, Download } from 'lucide-react';

const API_BASE_URL = 'https://ai-notetaker-backend-917362189743.us-central1.run.app';

interface SharedNoteData {
  note: {
    title: string;
    content: string;
    sourceType: string;
    createdAt: string;
  };
  share: {
    viewCount: number;
    createdAt: string;
    allowComments: boolean;
  };
}

export default function SharedNotePage() {
  const params = useParams();
  const token = params.token as string;
  const [data, setData] = useState<SharedNoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    fetch(`${API_BASE_URL}/api/shared/${token}`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setData(json.data);
        } else {
          setError(json.error || 'Note not found');
        }
      })
      .catch(() => setError('Failed to load shared note'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--accent-purple)' }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--background)' }}>
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--accent-red)' }} />
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            {error || 'Note not found'}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            This share link may have expired or been revoked.
          </p>
          <a
            href="https://scribeai.app"
            className="inline-block mt-6 px-6 py-3 rounded-lg text-white font-medium"
            style={{ background: 'var(--accent-purple)' }}
          >
            Try Scribe AI
          </a>
        </div>
      </div>
    );
  }

  const { note, share } = data;
  const formattedDate = new Date(note.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const wordCount = note.content.split(/\s+/).filter(Boolean).length;

  const sourceLabel: Record<string, string> = {
    recording: 'Audio Recording',
    pdf: 'PDF Upload',
    video: 'YouTube Video',
    scan: 'Scanned Document',
    upload: 'File Upload',
    meeting: 'Meeting Transcription',
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      {/* Header */}
      <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--card-background)' }}>
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5" style={{ color: 'var(--accent-purple)' }} />
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Scribe AI</span>
          </div>
          <a
            href="https://scribeai.app"
            className="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--accent-purple)' }}
          >
            Get Scribe AI
          </a>
        </div>
      </header>

      {/* Note content */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          {note.title}
        </h1>

        {/* Metadata */}
        <div className="flex flex-wrap gap-4 mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            {formattedDate}
          </span>
          {note.sourceType && (
            <span>{sourceLabel[note.sourceType] || note.sourceType}</span>
          )}
          <span>{wordCount.toLocaleString()} words</span>
          <span className="flex items-center gap-1">
            <Eye className="w-4 h-4" />
            {share.viewCount} views
          </span>
        </div>

        <hr className="mb-6" style={{ borderColor: 'var(--border)' }} />

        {/* Content */}
        <article
          className="prose prose-invert max-w-none leading-relaxed text-base"
          style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}
        >
          {note.content}
        </article>

        {/* Footer CTA */}
        <div className="mt-12 p-6 rounded-xl text-center" style={{ background: 'var(--card-background)', border: '1px solid var(--border)' }}>
          <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Create notes like this with Scribe AI
          </h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            Record lectures, upload PDFs, or paste content — AI generates summaries, quizzes, flashcards, and more.
          </p>
          <a
            href="https://scribeai.app"
            className="inline-block px-6 py-3 rounded-lg text-white font-medium"
            style={{ background: 'var(--accent-purple)' }}
          >
            Try Scribe AI Free
          </a>
        </div>
      </main>
    </div>
  );
}

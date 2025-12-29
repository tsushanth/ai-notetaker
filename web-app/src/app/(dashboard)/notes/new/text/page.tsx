'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { notesApi } from '@/lib/api';
import {
  ArrowLeft,
  FileText,
  Loader2,
  AlertCircle,
  Sparkles,
  Copy
} from 'lucide-react';

export default function TextNotePage() {
  const router = useRouter();
  const { token } = useAuthStore();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!content.trim() || !token) return;

    setIsCreating(true);
    setError(null);

    try {
      const response = await notesApi.create(token, {
        title: title.trim() || 'Untitled Note',
        content: content.trim(),
        sourceType: 'text'
      });
      router.push(`/notes/${(response as { note: { id: string } }).note.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create note');
    } finally {
      setIsCreating(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setContent(prev => prev + text);
        setError(null);
      }
    } catch {
      // Clipboard access denied - silent fail
    }
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/notes"
          className="p-2 hover:bg-[var(--surface-variant)] rounded-lg transition"
        >
          <ArrowLeft size={24} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Create from Text</h1>
          <p className="text-[var(--text-secondary)]">
            Paste or type your content to create a note
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-3 p-4 mb-6 bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/20 rounded-lg">
          <AlertCircle className="w-5 h-5 text-[var(--accent-red)]" />
          <p className="text-[var(--accent-red)]">{error}</p>
        </div>
      )}

      <div className="card">
        {/* Title Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title (optional)"
            className="input"
          />
        </div>

        {/* Content Input */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">
              Content
            </label>
            <button
              onClick={handlePaste}
              className="flex items-center gap-1.5 text-sm text-[var(--accent-purple)] hover:text-[var(--accent-purple-light)] transition"
            >
              <Copy size={14} />
              Paste from clipboard
            </button>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste your content here... It could be lecture notes, article text, study material, or any content you'd like to learn from."
            className="input min-h-[300px] resize-y"
          />
          <div className="flex items-center justify-between mt-2 text-sm text-[var(--text-muted)]">
            <span>{wordCount} words</span>
            <span>{charCount} characters</span>
          </div>
        </div>

        {/* Create Button */}
        <button
          onClick={handleCreate}
          disabled={isCreating || !content.trim()}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCreating ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Creating note...
            </>
          ) : (
            <>
              <Sparkles size={20} />
              Create Note
            </>
          )}
        </button>
      </div>

      {/* Info */}
      <div className="mt-6 p-4 bg-[var(--surface-variant)] rounded-lg">
        <div className="flex gap-3">
          <FileText className="w-5 h-5 text-[var(--accent-purple)] flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium mb-1">What happens next?</p>
            <p className="text-sm text-[var(--text-secondary)]">
              After creating your note, our AI will analyze the content and
              generate quizzes, flashcards, and a chat assistant to help you
              learn the material effectively.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

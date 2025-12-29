'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { notesApi } from '@/lib/api';
import {
  ArrowLeft,
  Youtube,
  Loader2,
  AlertCircle,
  Link as LinkIcon,
  Sparkles
} from 'lucide-react';

export default function YoutubeNotePage() {
  const router = useRouter();
  const { token } = useAuthStore();
  const [url, setUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidYoutubeUrl = (url: string): boolean => {
    const patterns = [
      /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+/,
      /^(https?:\/\/)?(www\.)?youtu\.be\/[\w-]+/,
      /^(https?:\/\/)?(www\.)?youtube\.com\/embed\/[\w-]+/
    ];
    return patterns.some(pattern => pattern.test(url));
  };

  const handleProcess = async () => {
    if (!url.trim() || !token) return;

    if (!isValidYoutubeUrl(url)) {
      setError('Please enter a valid YouTube URL');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const response = await notesApi.processYoutube(token, url.trim());
      router.push(`/notes/${(response as { note: { id: string } }).note.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process YouTube video');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && isValidYoutubeUrl(text)) {
        setUrl(text);
        setError(null);
      }
    } catch {
      // Clipboard access denied - silent fail
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/notes"
          className="p-2 hover:bg-[var(--surface-variant)] rounded-lg transition"
        >
          <ArrowLeft size={24} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">YouTube Video</h1>
          <p className="text-[var(--text-secondary)]">
            Generate notes from any YouTube video
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
        {/* YouTube Icon */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto bg-red-500/20 rounded-2xl flex items-center justify-center mb-4">
            <Youtube className="w-10 h-10 text-red-500" />
          </div>
          <p className="text-[var(--text-secondary)]">
            Paste a YouTube URL to extract and summarize the content
          </p>
        </div>

        {/* URL Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            YouTube URL
          </label>
          <div className="relative">
            <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" />
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="https://youtube.com/watch?v=..."
              className="input pl-12 pr-20"
            />
            <button
              onClick={handlePaste}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 text-sm font-medium text-[var(--accent-purple)] hover:bg-[var(--surface-variant)] rounded-lg transition"
            >
              Paste
            </button>
          </div>
        </div>

        {/* Process Button */}
        <button
          onClick={handleProcess}
          disabled={isProcessing || !url.trim()}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Processing video...
            </>
          ) : (
            <>
              <Sparkles size={20} />
              Generate Notes
            </>
          )}
        </button>
      </div>

      {/* How It Works */}
      <div className="mt-8 card">
        <h2 className="font-semibold mb-4">How it works</h2>
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--accent-purple)]/20 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-medium text-[var(--accent-purple)]">1</span>
            </div>
            <div>
              <p className="font-medium">Extract transcript</p>
              <p className="text-sm text-[var(--text-secondary)]">
                We extract the video's transcript or captions
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--accent-purple)]/20 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-medium text-[var(--accent-purple)]">2</span>
            </div>
            <div>
              <p className="font-medium">AI processing</p>
              <p className="text-sm text-[var(--text-secondary)]">
                Our AI analyzes and structures the content
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--accent-purple)]/20 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-medium text-[var(--accent-purple)]">3</span>
            </div>
            <div>
              <p className="font-medium">Get your notes</p>
              <p className="text-sm text-[var(--text-secondary)]">
                Receive organized notes, quizzes, and flashcards
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

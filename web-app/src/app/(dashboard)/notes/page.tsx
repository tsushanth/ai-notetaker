'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useNotesStore } from '@/store/notesStore';
import { notesApi } from '@/lib/api';
import {
  Plus,
  Mic,
  FileText,
  Youtube,
  Camera,
  Search,
  Loader2,
  Clock,
  FileAudio,
  File,
  Video,
  ScanLine,
  MoreVertical,
  Trash2
} from 'lucide-react';
import type { Note } from '@/types';

export default function NotesPage() {
  const router = useRouter();
  const { token } = useAuthStore();
  const { notes, setNotes, removeNote, isLoading, setLoading, error, setError } = useNotesStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewNoteMenu, setShowNewNoteMenu] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      fetchNotes();
    }
  }, [token]);

  const fetchNotes = async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const response = await notesApi.getAll(token);
      // Ensure notes is always an array
      setNotes(Array.isArray(response.notes) ? response.notes as Note[] : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch notes');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!token) return;

    setDeletingId(noteId);
    try {
      await notesApi.delete(token, noteId);
      removeNote(noteId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete note');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredNotes = (notes || []).filter(note =>
    note?.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    note?.content?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getSourceIcon = (sourceType?: string) => {
    switch (sourceType) {
      case 'audio':
      case 'recording':
        return <FileAudio className="w-4 h-4" />;
      case 'pdf':
        return <File className="w-4 h-4" />;
      case 'youtube':
        return <Video className="w-4 h-4" />;
      case 'scan':
        return <ScanLine className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">My Notes</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            {(notes || []).length} {(notes || []).length === 1 ? 'note' : 'notes'}
          </p>
        </div>

        {/* New Note Button */}
        <div className="relative">
          <button
            onClick={() => setShowNewNoteMenu(!showNewNoteMenu)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={20} />
            New Note
          </button>

          {showNewNoteMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowNewNoteMenu(false)}
              />
              <div className="absolute right-0 top-full mt-2 w-56 bg-[var(--card-background)] border border-[var(--border)] rounded-lg shadow-lg z-50 overflow-hidden">
                <Link
                  href="/notes/new/record"
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-variant)] transition"
                  onClick={() => setShowNewNoteMenu(false)}
                >
                  <Mic className="w-5 h-5 text-[var(--accent-purple)]" />
                  <div>
                    <p className="font-medium">Record Audio</p>
                    <p className="text-xs text-[var(--text-muted)]">Transcribe voice recordings</p>
                  </div>
                </Link>
                <Link
                  href="/notes/new/upload"
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-variant)] transition"
                  onClick={() => setShowNewNoteMenu(false)}
                >
                  <FileText className="w-5 h-5 text-[var(--accent-purple)]" />
                  <div>
                    <p className="font-medium">Upload PDF</p>
                    <p className="text-xs text-[var(--text-muted)]">Extract text from documents</p>
                  </div>
                </Link>
                <Link
                  href="/notes/new/youtube"
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-variant)] transition"
                  onClick={() => setShowNewNoteMenu(false)}
                >
                  <Youtube className="w-5 h-5 text-[var(--accent-purple)]" />
                  <div>
                    <p className="font-medium">YouTube Video</p>
                    <p className="text-xs text-[var(--text-muted)]">Generate notes from videos</p>
                  </div>
                </Link>
                <Link
                  href="/notes/new/text"
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-variant)] transition"
                  onClick={() => setShowNewNoteMenu(false)}
                >
                  <Camera className="w-5 h-5 text-[var(--accent-purple)]" />
                  <div>
                    <p className="font-medium">Paste Text</p>
                    <p className="text-xs text-[var(--text-muted)]">Create from existing content</p>
                  </div>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)] pointer-events-none z-10" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search notes..."
          className="w-full py-3 pr-4 bg-[var(--background)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent-purple)]"
          style={{ paddingLeft: '48px' }}
        />
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--accent-purple)]" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card text-center py-8">
          <p className="text-[var(--accent-red)] mb-4">{error}</p>
          <button onClick={fetchNotes} className="btn-secondary">
            Try Again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredNotes.length === 0 && (
        <div className="card text-center py-16">
          <FileText className="w-16 h-16 mx-auto text-[var(--text-muted)] mb-4" />
          <h2 className="text-xl font-semibold mb-2">
            {searchQuery ? 'No matching notes' : 'No notes yet'}
          </h2>
          <p className="text-[var(--text-secondary)] mb-6">
            {searchQuery
              ? 'Try a different search term'
              : 'Create your first note by recording audio, uploading a PDF, or pasting text'}
          </p>
          {!searchQuery && (
            <button
              onClick={() => setShowNewNoteMenu(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus size={20} />
              Create Note
            </button>
          )}
        </div>
      )}

      {/* Notes Grid */}
      {!isLoading && !error && filteredNotes.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredNotes.map((note) => (
            <div
              key={note.id}
              className="card hover:border-[var(--accent-purple)] transition cursor-pointer group relative"
            >
              <Link href={`/notes/${note.id}`} className="block">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 text-[var(--text-muted)]">
                    {getSourceIcon(note.source_type)}
                    <span className="text-xs capitalize">{note.source_type || 'text'}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    <Clock size={12} />
                    {formatDate(note.created_at)}
                  </div>
                </div>

                <h3 className="font-semibold mb-2 line-clamp-2 group-hover:text-[var(--accent-purple-light)] transition">
                  {note.title}
                </h3>

                <p className="text-sm text-[var(--text-secondary)] line-clamp-3">
                  {note.content}
                </p>
              </Link>

              {/* Delete Button */}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (confirm('Are you sure you want to delete this note?')) {
                    handleDeleteNote(note.id);
                  }
                }}
                className="absolute top-4 right-4 p-2 rounded-lg bg-[var(--surface-variant)] opacity-0 group-hover:opacity-100 hover:bg-[var(--accent-red)] transition"
                disabled={deletingId === note.id}
              >
                {deletingId === note.id ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

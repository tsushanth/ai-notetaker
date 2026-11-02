'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Trash2, Loader2, AlertTriangle, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useNotesStore } from '@/store/notesStore';
import { useMeetingsStore } from '@/store/meetingsStore';
import { userApi } from '@/lib/api';
import {
  DELETE_CONFIRM_WORD,
  DELETE_REASONS,
  deletionBlocker,
  exportFilename,
  isDeleteConfirmed,
  serializeExport,
  type DeleteReasonId,
} from '@/lib/account';

/** Settings "Your data": download everything we hold as JSON, or permanently delete the account. */
export default function AccountDataSection({ access, accessLoaded }: { access: { isSubscribed: boolean; platform?: string } | null; accessLoaded: boolean }) {
  const router = useRouter();
  const { token, logout } = useAuthStore();
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState<DeleteReasonId | ''>('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const blocker = deletionBlocker(access);

  const handleExport = async () => {
    if (!token || isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const data = await userApi.exportData(token);
      const blob = new Blob([serializeExport(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export your data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const closeDialog = () => {
    if (isDeleting) return;
    setShowDelete(false);
    setTyped('');
    setReason('');
    setDeleteError(null);
  };

  const handleDelete = async () => {
    if (!token || isDeleting || blocker?.blocking || !isDeleteConfirmed(typed)) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await userApi.deleteAccount(token, reason || undefined);
      // The account is gone: drop the session and everything cached for it, then leave the app.
      useMeetingsStore.getState().stopPolling();
      useMeetingsStore.setState({ meetings: [] });
      useNotesStore.setState({ notes: [], currentNote: null, aiContent: {}, chatHistory: {} });
      logout();
      router.replace('/');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete your account. Please try again or contact support.');
      setIsDeleting(false);
    }
  };

  return (
    <div className="bg-[var(--card-background)] rounded-xl p-6 border border-[var(--border)] mt-6">
      <h2 className="text-lg font-semibold mb-1">Your data</h2>
      <p className="text-sm text-[var(--text-muted)] mb-4">Download a copy of what we hold about you, or delete your account.</p>

      <button
        onClick={handleExport}
        disabled={isExporting}
        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg border border-[var(--border)] hover:bg-[var(--surface-variant)] transition disabled:opacity-50"
      >
        {isExporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
        {isExporting ? 'Preparing your data...' : 'Download my data (JSON)'}
      </button>
      {exportError && <p role="alert" className="text-sm text-[var(--accent-red)] mt-2">{exportError}</p>}

      <div className="mt-6 pt-6 border-t border-[var(--border)]">
        <h3 className="font-medium text-[var(--accent-red)] mb-1">Delete account</h3>
        <p className="text-sm text-[var(--text-muted)] mb-3">
          Permanently deletes your account, notes, recordings and AI content. This cannot be undone.
        </p>
        <button
          onClick={() => setShowDelete(true)}
          disabled={!accessLoaded}
          title={accessLoaded ? undefined : 'Checking your subscription...'}
          className="flex items-center gap-2 py-2 px-4 rounded-lg border border-[var(--accent-red)] text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 transition disabled:opacity-50"
        >
          <Trash2 size={16} />
          Delete my account
        </button>
      </div>

      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-title">
          <div className="w-full max-w-md bg-[var(--card-background)] rounded-xl border border-[var(--border)] p-6">
            <div className="flex items-start justify-between mb-3">
              <h2 id="delete-title" className="flex items-center gap-2 text-lg font-semibold text-[var(--accent-red)]">
                <AlertTriangle size={20} />
                Delete your account?
              </h2>
              <button onClick={closeDialog} aria-label="Close" disabled={isDeleting}>
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              This permanently deletes your notes, recordings, AI content and sign-in. You will not be able to get them back. Consider downloading your data first.
            </p>

            {blocker && (
              <p className={`text-sm mb-4 p-3 rounded-lg ${blocker.blocking ? 'bg-[var(--accent-red)]/10 text-[var(--accent-red)]' : 'bg-[var(--surface-variant)] text-[var(--text-secondary)]'}`}>
                {blocker.message}
              </p>
            )}

            <label className="block text-sm text-[var(--text-muted)] mb-1" htmlFor="delete-reason">Why are you leaving? (optional)</label>
            <select
              id="delete-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as DeleteReasonId | '')}
              className="w-full mb-4 px-3 py-2 bg-[var(--surface-variant)] border border-[var(--border)] rounded-lg"
            >
              <option value="">Prefer not to say</option>
              {DELETE_REASONS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>

            <label className="block text-sm mb-1" htmlFor="delete-confirm">
              Type <strong>{DELETE_CONFIRM_WORD}</strong> to confirm
            </label>
            <input
              id="delete-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="w-full mb-4 px-3 py-2 bg-[var(--surface-variant)] border border-[var(--border)] rounded-lg"
            />

            {deleteError && <p role="alert" className="text-sm text-[var(--accent-red)] mb-3">{deleteError}</p>}

            <div className="flex justify-end gap-3">
              <button onClick={closeDialog} disabled={isDeleting} className="px-4 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--surface-variant)]">
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting || !!blocker?.blocking || !isDeleteConfirmed(typed)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-red)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isDeleting && <Loader2 size={16} className="animate-spin" />}
                {isDeleting ? 'Deleting...' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

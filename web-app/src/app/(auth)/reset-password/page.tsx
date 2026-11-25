'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { authApi } from '@/lib/api';
import { reportWebFailure } from '@/components/WebFailureReporter';
import { parseResetLink, passwordProblem, type ResetLink } from '@/lib/passwordReset';

// Both halves of a password reset: asking for the email, and (arriving from the link in it) setting the new password.
export default function ResetPasswordPage() {
  const [link, setLink] = useState<ResetLink | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'sent' | 'updated' | null>(null);

  useEffect(() => {
    // Also runs when the link is opened in a tab that is already on this page (only the fragment changes).
    const read = () => {
      const parsed = parseResetLink(window.location.hash, window.location.search);
      // Take the token out of the address bar and the history as soon as it has been read.
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
      setLink(parsed);
      if (parsed.kind === 'error') setError(parsed.message);
    };
    read();
    const onHash = () => { if (window.location.hash) read(); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const requestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await authApi.requestPasswordReset(email.trim());
      setDone('sent');
    } catch (err) {
      reportWebFailure('Password reset request', err);
      setError(err instanceof Error ? err.message : 'The reset email could not be sent. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const setNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || link?.kind !== 'token') return;
    const problem = passwordProblem(password, repeat);
    if (problem) return setError(problem);
    setError('');
    setBusy(true);
    try {
      await authApi.updatePassword(link.accessToken, password);
      setDone('updated');
    } catch (err) {
      reportWebFailure('Password update', err);
      setError(err instanceof Error ? err.message : 'The password could not be changed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const spinner = busy ? <Loader2 size={18} className="animate-spin" /> : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium mb-4">
          {link?.kind === 'token' ? 'Set a new password' : 'Reset your password'}
        </h1>

        {done === 'sent' && (
          <p role="status" className="text-sm">
            If an account exists for {email.trim()}, a reset link is on its way. Check your spam folder too.
          </p>
        )}
        {done === 'updated' && (
          <p role="status" className="text-sm">
            Your password has been changed. Sign in with it here or in the Scribe AI app.
          </p>
        )}

        {!done && link?.kind === 'token' && (
          <form onSubmit={setNewPassword} className="space-y-3" aria-label="Set a new password">
            <input type="password" required autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="New password" className="input" />
            <input type="password" required autoComplete="new-password" value={repeat}
              onChange={(e) => setRepeat(e.target.value)} placeholder="Repeat the new password" className="input" />
            <button type="submit" disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
              {spinner}
              Change password
            </button>
          </form>
        )}

        {!done && link && link.kind !== 'token' && (
          <form onSubmit={requestEmail} className="space-y-3" aria-label="Request a reset link">
            <input type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="input" />
            <button type="submit" disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
              {spinner}
              Send reset link
            </button>
          </form>
        )}

        {error && <p className="text-sm text-[var(--accent-red)] mt-4">{error}</p>}
        {error && link?.kind === 'token' && !done && (
          <button type="button" className="text-sm text-[var(--accent-purple-light)] hover:underline mt-2"
            onClick={() => { setLink({ kind: 'request' }); setError(''); }}>
            Request a new link
          </button>
        )}

        <p className="text-center text-sm mt-8">
          <Link href="/login" className="text-[var(--accent-purple-light)] hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}

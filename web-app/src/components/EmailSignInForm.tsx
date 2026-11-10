'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

/**
 * Email and password sign-in for accounts created with an email address (for example in the Android app), which could
 * not sign in on the web because the page only offered Google. Collapsed by default so Google stays the main path.
 * On success the login page's own effect redirects (it watches isAuthenticated).
 */
export default function EmailSignInForm() {
  const login = useAuthStore((s) => s.login);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const result = await authApi.loginWithEmail(email.trim(), password);
      login(result.user as Parameters<typeof login>[0], result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.');
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <p className="text-center text-sm mt-6">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[var(--accent-purple-light)] hover:underline"
        >
          Sign in with email and password
        </button>
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3" aria-label="Sign in with email">
      <input
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        className="input"
      />
      <input
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="input"
      />
      <button type="submit" disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
        {busy ? <Loader2 size={18} className="animate-spin" /> : null}
        Sign in
      </button>
      {error && <p className="text-sm text-[var(--accent-red)] text-center">{error}</p>}
    </form>
  );
}

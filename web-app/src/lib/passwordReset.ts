// What the reset link brought with it. Supabase puts the recovery session (or the reason it failed) in the URL fragment.
export type ResetLink =
  | { kind: 'request' }
  | { kind: 'token'; accessToken: string }
  | { kind: 'error'; message: string };

export const EXPIRED_LINK_MESSAGE = 'This reset link is invalid or has expired. Request a new one below.';

export function parseResetLink(hash: string, search = ''): ResetLink {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const query = new URLSearchParams(search);
  if (fragment.get('error') || fragment.get('error_code') || query.get('error') || query.get('error_code')) {
    return { kind: 'error', message: EXPIRED_LINK_MESSAGE };
  }
  const accessToken = fragment.get('access_token');
  if (accessToken && fragment.get('type') === 'recovery') return { kind: 'token', accessToken };
  return { kind: 'request' };
}

export function passwordProblem(password: string, repeat: string): string | null {
  if (password.length < 6) return 'Password must be at least 6 characters.';
  if (password !== repeat) return 'The two passwords do not match.';
  return null;
}

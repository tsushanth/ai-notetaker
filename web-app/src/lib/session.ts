// Pure helpers for "your session expired" handling. No imports, so they can be tested on their own.

/** A same-site path that is safe to return to after login, or null. Rejects other sites, protocol tricks and the login page itself. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.length > 500 || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login/') || raw.startsWith('/signup')) return null;
  return raw;
}

/** The login URL, optionally remembering where to come back to and why the user is here. */
export function loginUrl(next?: string | null, expired = false): string {
  const params = new URLSearchParams();
  if (expired) params.set('reason', 'expired');
  const n = safeNext(next);
  if (n) params.set('next', n);
  const q = params.toString();
  return q ? `/login?${q}` : '/login';
}

/**
 * True when a response means "the signed-in session is no longer valid": a 401 on a request that carried a bearer token and went
 * to our API. A 401 on a request with no token (a wrong password at sign-in, say) is not an expired session.
 */
export function isExpiredSession(args: { url: string; apiBase: string; hadBearer: boolean; status: number }): boolean {
  if (args.status !== 401 || !args.hadBearer) return false;
  return args.url === args.apiBase || args.url.startsWith(`${args.apiBase}/`);
}

/** Reads an Authorization header from any shape fetch accepts. */
export function hasBearer(init?: { headers?: unknown } | null, input?: unknown): boolean {
  const pick = (h: unknown): string => {
    if (!h) return '';
    if (typeof Headers !== 'undefined' && h instanceof Headers) return h.get('authorization') || '';
    if (Array.isArray(h)) return String((h.find((p) => String(p?.[0]).toLowerCase() === 'authorization') || [])[1] || '');
    if (typeof h === 'object') {
      const e = Object.entries(h as Record<string, unknown>).find(([k]) => k.toLowerCase() === 'authorization');
      return e ? String(e[1] ?? '') : '';
    }
    return '';
  };
  const fromInit = pick(init?.headers);
  const fromRequest = typeof Request !== 'undefined' && input instanceof Request ? input.headers.get('authorization') || '' : '';
  return /^Bearer\s+\S+/i.test(fromInit || fromRequest);
}

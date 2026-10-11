const API_BASE_URL = 'https://ai-notetaker-backend.fly.dev';

/**
 * True only when the bearer token belongs to an allowlisted account. The backend's
 * /api/auth/profile is the authority on who the token is. Registration there 409s on
 * an existing email, so the admin address cannot be claimed by someone else.
 */
export type AdminAuth = 'admin' | 'expired' | 'denied';

/** 'expired' when the token is no longer valid (so the page can send the user back to login), 'denied' for a valid non-admin. */
export async function adminAuthStatus(authorization: string | null): Promise<AdminAuth> {
  if (!authorization?.startsWith('Bearer ')) return 'expired';
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/profile`, {
      headers: { Authorization: authorization },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) return 'expired';
    if (!res.ok) return 'denied';
    const email = String((await res.json())?.user?.email ?? '').toLowerCase();
    const allowed = (process.env.ADMIN_EMAILS || 't.sushanth@gmail.com').split(',').map((e) => e.trim().toLowerCase());
    return !!email && allowed.includes(email) ? 'admin' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function isAdminToken(authorization: string | null): Promise<boolean> {
  return (await adminAuthStatus(authorization)) === 'admin';
}

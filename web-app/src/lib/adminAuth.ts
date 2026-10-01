const API_BASE_URL = 'https://ai-notetaker-backend.fly.dev';

/**
 * True only when the bearer token belongs to an allowlisted account. The backend's
 * /api/auth/profile is the authority on who the token is. Registration there 409s on
 * an existing email, so the admin address cannot be claimed by someone else.
 */
export async function isAdminToken(authorization: string | null): Promise<boolean> {
  if (!authorization?.startsWith('Bearer ')) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/profile`, {
      headers: { Authorization: authorization },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const email = String((await res.json())?.user?.email ?? '').toLowerCase();
    const allowed = (process.env.ADMIN_EMAILS || 't.sushanth@gmail.com').split(',').map((e) => e.trim().toLowerCase());
    return !!email && allowed.includes(email);
  } catch {
    return false;
  }
}

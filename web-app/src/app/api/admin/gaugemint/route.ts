// GET /api/admin/gaugemint?period=7d|30d|12mo: landing-page visit numbers of this site from Gaugemint, for the admin dashboard.
// Same admin check as /api/admin/overview (401 expired session, 404 unless the signed-in account is allowlisted). Separate route on
// purpose: a slow or broken Gaugemint can only affect this card, never the overview. The key (GAUGEMINT_READ_KEY) stays on the
// server and the domain is fixed by GAUGEMINT_DOMAIN, never taken from the request.
import { NextResponse } from 'next/server';
import { adminAuthStatus } from '@/lib/adminAuth';
import { adminGaugemint } from '@/lib/adminGaugemint';
import { getGaugemintStats } from '@/lib/gaugemintRead';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await adminAuthStatus(request.headers.get('authorization'));
  if (auth === 'expired') return NextResponse.json({ error: 'session expired' }, { status: 401 }); // the page sends the user back to login
  if (auth !== 'admin') return new NextResponse('Not found', { status: 404 });

  const r = await adminGaugemint({ isAdmin: true, period: new URL(request.url).searchParams.get('period'), getStats: getGaugemintStats });
  return new NextResponse(r.body, { status: r.status, headers: { 'Content-Type': r.contentType, 'Cache-Control': 'no-store' } });
}

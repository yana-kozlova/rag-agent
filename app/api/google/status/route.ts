import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { checkGoogleAccess } from '@/lib/auth/google-token';
import { needsReconnect } from '@/lib/auth/google-access';

/**
 * Is this account's Google permission still alive?
 *
 * Session-authenticated and deliberately absent from the middleware's public
 * paths: it answers about the caller's own account and nobody else's.
 *
 * Note that a signed-in session proves nothing about Google access. Sessions
 * here are JWTs valid for weeks, while a refresh token can end in seven days —
 * which is the whole reason this endpoint exists rather than the panel reading
 * the session and assuming.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = await checkGoogleAccess(session.user.id);

  return NextResponse.json({ status, needsReconnect: needsReconnect(status) });
}

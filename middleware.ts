import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Cron- and QStash-invoked endpoints: they carry no NextAuth session, so they
// must bypass the session gate here and authenticate themselves with
// validateCronSecret instead. Without this the auth redirect below swallows
// every cron/QStash callback and notifications are enqueued but never delivered.
const publicPaths = [
  '/signin',
  '/api/auth',
  '/api/push/scheduled',
  '/api/push/drain',
  '/api/push/briefing-user',
  '/api/push/retrospective',
  // Telegram carries no session: the webhook authenticates with the secret
  // token Telegram echoes back, its QStash callback with CRON_SECRET.
  // `/api/telegram/link` is deliberately absent — that one needs a signed-in
  // user, and `startsWith` would have made a bare '/api/telegram' cover it.
  '/api/telegram/webhook',
  '/api/telegram/process',
];

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // `getToken` defaults `secureCookie` to false and then derives both the
  // cookie name and the decryption salt from it — so without this it looks for
  // `authjs.session-token` while an HTTPS deployment sets
  // `__Secure-authjs.session-token`, never finds a session, and redirects every
  // signed-in request back to /signin. Locally over HTTP the names coincide,
  // which is why it only ever broke in production.
  //
  // Read from the request rather than NEXTAUTH_URL: an env var can drift from
  // where the app is actually served, and this one already had.
  const isSecure =
    req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    secureCookie: isSecure,
  });
  const isLoggedIn = !!token;

  // Redirect to sign-in if not logged in
  if (!isLoggedIn) {
    const signInUrl = new URL('/signin', req.url);
    // Preserve the original URL as callback
    signInUrl.searchParams.set('callbackUrl', req.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
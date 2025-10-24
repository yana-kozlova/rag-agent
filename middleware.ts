import { auth } from "@/app/api/auth/auth";
import { NextResponse } from "next/server";

const publicPaths = ['/signin', '/api/auth'];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  
  // Allow public paths
  if (publicPaths.some(path => pathname.startsWith(path))) {
    return null;
  }

  const isLoggedIn = !!req.auth;

  // Redirect to sign-in if not logged in
  if (!isLoggedIn) {
    return NextResponse.redirect(new URL('/signin', req.url));
  }

  return null;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
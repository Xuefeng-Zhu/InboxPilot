import { NextRequest, NextResponse } from 'next/server';

/**
 * Auth proxy — redirects unauthenticated users to /login.
 *
 * Protected routes: everything except public auth/recovery routes and static assets.
 * Authentication is determined by the presence of the `insforge_access_token`
 * cookie or the token stored in localStorage (checked client-side).
 *
 * Because localStorage is not accessible in the proxy (runs on Node.js),
 * we check for a cookie. The AuthProvider on the client side also handles
 * redirect for cases where the cookie is absent but localStorage has a token.
 *
 * Requirement 17.4: Unauthenticated users on protected routes SHALL redirect to /login.
 */

/** Routes that do not require authentication. */
const PUBLIC_PATHS = ['/', '/login', '/register', '/forgot-password', '/reset-password'];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (pathname === '/' || PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  // Allow Next.js internals and static files
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/functions') ||
    pathname.startsWith('/wchat') ||
    pathname.includes('.') // static files (favicon.ico, images, etc.)
  ) {
    return NextResponse.next();
  }

  // Check for access token in cookies
  const token = request.cookies.get('insforge_access_token')?.value;

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

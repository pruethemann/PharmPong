import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirect only: real authorization happens in pages, actions and services.
const PROTECTED = ["/team", "/referee", "/admin", "/profile"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (!request.cookies.has("pp_session")) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/team/:path*", "/referee/:path*", "/admin/:path*", "/profile/:path*"],
};

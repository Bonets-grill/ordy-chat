import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthed = !!req.auth;
  const isAdmin = req.auth?.user?.role === "super_admin";

  if (pathname.startsWith("/admin")) {
    if (!isAuthed) return NextResponse.redirect(new URL("/signin?from=/admin", req.url));
    if (!isAdmin) return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  const protectedApp =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/conversations") ||
    pathname.startsWith("/agent") ||
    pathname.startsWith("/billing");

  if (protectedApp && !isAuthed) {
    return NextResponse.redirect(new URL(`/signin?from=${pathname}`, req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/conversations/:path*",
    "/agent/:path*",
    "/billing/:path*",
    "/admin/:path*",
  ],
};

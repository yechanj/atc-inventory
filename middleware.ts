import { NextRequest, NextResponse } from "next/server";
import { verifyJwt, cookieName } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/api/auth");

  if (isPublic) return NextResponse.next();

  const token = request.cookies.get(cookieName())?.value;
  const payload = token ? await verifyJwt(token) : null;

  if (!payload) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|fonts|favicon\\.ico).*)"],
};

import { NextResponse } from "next/server";
import { clearCookieOptions } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true, data: {} });
  res.cookies.set(clearCookieOptions());
  return res;
}

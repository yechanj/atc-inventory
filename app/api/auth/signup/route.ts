import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signJwt, sessionCookieOptions } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { username, password, hospitalName } = await req.json();

    if (!username || !password || !hospitalName) {
      return NextResponse.json({ ok: false, error: "모든 항목을 입력해주세요." }, { status: 400 });
    }
    if (password.length < 4) {
      return NextResponse.json({ ok: false, error: "비밀번호는 4자 이상이어야 합니다." }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ ok: false, error: "이미 사용 중인 아이디입니다." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { hospital, user } = await prisma.$transaction(async (tx) => {
      const hospital = await tx.hospital.create({ data: { name: hospitalName } });
      const user = await tx.user.create({
        data: { username, passwordHash, hospitalId: hospital.id },
      });
      return { hospital, user };
    });

    const token = await signJwt({ userId: user.id, hospitalId: hospital.id });
    const res = NextResponse.json({ ok: true, data: { username } });
    res.cookies.set(sessionCookieOptions(token));
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

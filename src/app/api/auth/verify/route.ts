import { NextResponse } from "next/server";
import { isValidInviteCode } from "@/lib/server/auth";
import { getDailyLimit } from "@/lib/server/quota";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim();
  if (!code) {
    return NextResponse.json({ ok: false, error: "请输入邀请码" }, { status: 400 });
  }
  if (!isValidInviteCode(code)) {
    return NextResponse.json({ ok: false, error: "邀请码无效" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, inviteCode: code, dailyLimit: getDailyLimit() });
}


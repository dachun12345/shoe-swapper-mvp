import { NextResponse } from "next/server";
import { getJob } from "@/lib/server/jobs/store";
import { isValidInviteCode } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const inviteCode = req.headers.get("x-invite-code")?.trim();
  if (!isValidInviteCode(inviteCode)) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ ok: false, error: "任务不存在或已过期" }, { status: 404 });

  return NextResponse.json({ ok: true, job });
}

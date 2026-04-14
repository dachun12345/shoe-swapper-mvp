import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { getJob } from "@/lib/server/jobs/store";
import { isValidInviteCode } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fileNameByMime(mime: string) {
  if (mime.startsWith("image/")) return "result.png";
  if (mime.startsWith("video/")) return "result.mp4";
  return "result.bin";
}

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
  if (job.status !== "succeeded" || !job.outputPath || !job.outputMimeType) {
    return NextResponse.json({ ok: false, error: "任务尚未完成" }, { status: 409 });
  }

  await stat(job.outputPath); // throws if missing
  const stream = createReadStream(job.outputPath);

  const headers = new Headers();
  headers.set("Content-Type", job.outputMimeType);
  headers.set(
    "Content-Disposition",
    `attachment; filename="${fileNameByMime(job.outputMimeType)}"`
  );
  headers.set("X-Job-Id", id);
  headers.set("X-Provider", process.env.DEFAULT_PROVIDER ?? "mock-provider");
  headers.set("X-Expires-At", String(job.expiresAt));

  // node stream is acceptable in Next route handlers (nodejs runtime)
  return new Response(stream as unknown as ReadableStream<Uint8Array>, { headers });
}

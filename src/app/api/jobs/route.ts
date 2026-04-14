import { NextResponse } from "next/server";
import path from "node:path";
import { nanoid } from "nanoid";
import { isValidInviteCode } from "@/lib/server/auth";
import { checkAndConsumeQuota } from "@/lib/server/quota";
import { createJob } from "@/lib/server/jobs/store";
import type { CreateJobInput, EditIntent, NormalizedBox, VideoOutputPreset } from "@/lib/server/jobs/types";
import { saveWebFileToDisk, tmpDir } from "@/lib/server/fs";
import { probeVideo } from "@/lib/server/videoProbe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function isBox(v: unknown): v is NormalizedBox {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.x === "number" && typeof o.y === "number" && typeof o.w === "number" && typeof o.h === "number";
}

function parseSelection(raw: string | null): NormalizedBox[] | null {
  // null 表示不框选，走自动检测
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v)) {
      const boxes = v.filter(isBox);
      return boxes.length > 0 ? boxes : [];
    }
    if (isBox(v)) return [v];
    return null;
  } catch {
    return null;
  }
}

function ensureFile(f: FormDataEntryValue | null, name: string, maxBytes: number): File | null {
  if (!f) return null;
  if (typeof f === "string") return null;
  if (f.size > maxBytes) {
    const mb = Math.round((maxBytes / 1024 / 1024) * 10) / 10;
    throw new Error(`${name} 超过${mb}MB限制`);
  }
  return f;
}

export async function POST(req: Request) {
  const inviteCode = req.headers.get("x-invite-code")?.trim();
  if (!isValidInviteCode(inviteCode)) {
    return bad("未登录或邀请码无效", 401);
  }

  const quota = checkAndConsumeQuota(inviteCode!, 1);
  if (!quota.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `今日额度已用尽（上限${quota.limit}/天）`,
        quota,
      },
      { status: 429 }
    );
  }

  try {
    const form = await req.formData();
    const modeValue = form.get("mode");
    if (modeValue !== "image" && modeValue !== "video") return bad("mode 参数错误");
    const mode = modeValue;
    const category = String(form.get("category") ?? "");
    const extra = String(form.get("extra") ?? "");
    const intentValue = String(form.get("intent") ?? "shoe");
    const intent: EditIntent = intentValue === "background" ? "background" : "shoe";
    const selectionRaw = form.get("selection");
    const selection = parseSelection(typeof selectionRaw === "string" ? selectionRaw : null);

    if (category !== "鞋子") return bad("当前仅支持“鞋子”类目");
    // selection 为 null/[] 允许：表示不框选，走自动检测鞋子

    const productFiles = form.getAll("productImages").map((v) => ensureFile(v, "产品图", MAX_IMAGE_BYTES));
    const productImages = productFiles.filter(Boolean) as File[];
    if (productImages.length !== 3) return bad("请上传3张产品图（不同角度更好）");

    const uploadToken = nanoid();
    const uploadDir = tmpDir("uploads", uploadToken);

    const productImagePaths: string[] = [];
    for (let i = 0; i < productImages.length; i++) {
      const f = productImages[i];
      const ext = f.type.includes("png") ? "png" : "jpg";
      const p = path.join(uploadDir, `product_${i + 1}.${ext}`);
      await saveWebFileToDisk(f, p);
      productImagePaths.push(p);
    }

    let mimicPath = "";
    let mimeType = "";
    let videoPreset: VideoOutputPreset | undefined;
    let videoDurationSec: number | undefined;

    if (mode === "image") {
      const mimic = ensureFile(form.get("mimicImage"), "模仿图", MAX_IMAGE_BYTES);
      if (!mimic) return bad("请上传1张模仿图");
      const ext = mimic.type.includes("png") ? "png" : "jpg";
      mimicPath = path.join(uploadDir, `mimic.${ext}`);
      await saveWebFileToDisk(mimic, mimicPath);
      mimeType = mimic.type || "image/*";
    } else {
      const mimic = ensureFile(form.get("mimicVideo"), "模仿视频", MAX_VIDEO_BYTES);
      if (!mimic) return bad("请上传1个模仿视频");
      if (!(mimic.type || "").includes("video")) return bad("模仿视频格式不正确");
      mimicPath = path.join(uploadDir, `mimic.mp4`);
      await saveWebFileToDisk(mimic, mimicPath);
      mimeType = mimic.type || "video/mp4";

      const presetValue = String(form.get("videoPreset") ?? "720p");
      const preset = presetValue as VideoOutputPreset;
      if (preset !== "720p" && preset !== "1080p") return bad("videoPreset 参数错误");
      videoPreset = preset;

      const meta = await probeVideo(mimicPath);

      // 输出时长规则：
      // - 参考视频 <= 30s：输出时长默认等于原视频时长
      // - 参考视频 > 30s：用户必须选择 7/15/30
      const rawDur = meta.durationSec ?? 0;
      const originalDur = Number.isFinite(rawDur) ? Math.max(1, Math.round(rawDur)) : 0;
      const durationValue = String(form.get("videoDurationSec") ?? "");
      if (durationValue) {
        const n = Number(durationValue);
        if (!Number.isFinite(n) || n <= 0) return bad("videoDurationSec 参数错误");
        videoDurationSec = Math.round(n);
      }
      if (originalDur > 30) {
        if (![7, 15, 30].includes(videoDurationSec ?? -1)) {
          return bad("参考视频超过30秒时，请选择输出时长：7秒 / 15秒 / 30秒");
        }
      } else if (originalDur > 0) {
        videoDurationSec = originalDur; // 强制等于原视频时长
      } else {
        // 无法探测时长时，要求用户选择一个兜底时长
        if (![7, 15, 30].includes(videoDurationSec ?? -1)) {
          return bad("无法读取参考视频时长，请选择输出时长：7秒 / 15秒 / 30秒");
        }
      }

      // 永远不超过30秒
      videoDurationSec = Math.min(30, videoDurationSec ?? 7);
    }

    const input: CreateJobInput = {
      mode,
      category: "鞋子",
      extra,
      intent,
      selection,
      productImagePaths,
      mimicPath,
      videoPreset,
      videoDurationSec: mode === "video" ? videoDurationSec : undefined,
      mimeType,
    };

    const job = createJob(input);

    return NextResponse.json({ ok: true, job, quota });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "创建任务失败", quota },
      { status: 400 }
    );
  }
}

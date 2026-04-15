import { NextResponse } from "next/server";
import path from "node:path";
import { nanoid } from "nanoid";
import { isValidInviteCode } from "@/lib/server/auth";
import { checkAndConsumeQuota } from "@/lib/server/quota";
import { createJob } from "@/lib/server/jobs/store";
import type { AspectRatio, CreateJobInput, EditIntent, NormalizedBox, VideoOutputPreset } from "@/lib/server/jobs/types";
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

function parseAspectRatio(raw: FormDataEntryValue | null): AspectRatio | undefined {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return undefined;
  const allowed: AspectRatio[] = ["3:4", "4:3", "9:16", "16:9", "1:1", "4:5", "2:3", "21:9"];
  return (allowed as string[]).includes(v) ? (v as AspectRatio) : undefined;
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
    if (
      modeValue !== "image" &&
      modeValue !== "video" &&
      modeValue !== "prompt" &&
      modeValue !== "prompt_image" &&
      modeValue !== "t2v" &&
      modeValue !== "t2i"
    ) {
      return bad("mode 参数错误");
    }
    const mode = modeValue as CreateJobInput["mode"];
    const category = String(form.get("category") ?? "");
    const uploadToken = nanoid();
    const uploadDir = tmpDir("uploads", uploadToken);
    const aspectRatio = parseAspectRatio(form.get("aspectRatio"));
    // model overrides (optional)
    const visionModel = String(form.get("visionModel") ?? "").trim() || undefined;
    const seedreamModel = String(form.get("seedreamModel") ?? "").trim() || undefined;
    const seedanceModel = String(form.get("seedanceModel") ?? "").trim() || undefined;

    let input: CreateJobInput;

    if (mode === "image" || mode === "video") {
      if (category !== "鞋子") return bad("当前仅支持“鞋子”类目");

      const extra = String(form.get("extra") ?? "");
      const intentValue = String(form.get("intent") ?? "shoe");
      const intent: EditIntent = intentValue === "background" ? "background" : "shoe";
      const selectionRaw = form.get("selection");
      const selection = parseSelection(typeof selectionRaw === "string" ? selectionRaw : null);

      const productFiles = form.getAll("productImages").map((v) => ensureFile(v, "产品图", MAX_IMAGE_BYTES));
      const productImages = productFiles.filter(Boolean) as File[];
      if (productImages.length < 3 || productImages.length > 5) return bad("请上传3~5张产品图（不同角度更好）");

      const productImagePaths: string[] = [];
      for (let i = 0; i < productImages.length; i++) {
        const f = productImages[i];
        const ext = f.type.includes("png") ? "png" : "jpg";
        const p = path.join(uploadDir, `product_${i + 1}.${ext}`);
        await saveWebFileToDisk(f, p);
        productImagePaths.push(p);
      }

      if (mode === "image") {
        const mimic = ensureFile(form.get("mimicImage"), "模仿图", MAX_IMAGE_BYTES);
        if (!mimic) return bad("请上传1张模仿图");
        const ext = mimic.type.includes("png") ? "png" : "jpg";
        const mimicPath = path.join(uploadDir, `mimic.${ext}`);
        await saveWebFileToDisk(mimic, mimicPath);

        input = {
          mode: "image",
          category: "鞋子",
          extra,
          intent,
          selection,
          productImagePaths,
          mimicPath,
          aspectRatio,
          mimeType: mimic.type || "image/*",
          visionModel,
          seedreamModel,
        };
      } else {
        const mimic = ensureFile(form.get("mimicVideo"), "模仿视频", MAX_VIDEO_BYTES);
        if (!mimic) return bad("请上传1个模仿视频");
        if (!(mimic.type || "").includes("video")) return bad("模仿视频格式不正确");
        const mimicPath = path.join(uploadDir, `mimic.mp4`);
        await saveWebFileToDisk(mimic, mimicPath);

        const presetValue = String(form.get("videoPreset") ?? "720p");
        const preset = presetValue as VideoOutputPreset;
        if (preset !== "720p" && preset !== "1080p") return bad("videoPreset 参数错误");

        const meta = await probeVideo(mimicPath);
        const rawDur = meta.durationSec ?? 0;
        const originalDur = Number.isFinite(rawDur) ? Math.max(1, Math.round(rawDur)) : 0;
        const durationValue = String(form.get("videoDurationSec") ?? "");
        let videoDurationSec: number | undefined;
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
          videoDurationSec = originalDur;
        } else {
          if (![7, 15, 30].includes(videoDurationSec ?? -1)) {
            return bad("无法读取参考视频时长，请选择输出时长：7秒 / 15秒 / 30秒");
          }
        }
        videoDurationSec = Math.min(30, videoDurationSec ?? 7);

        input = {
          mode: "video",
          category: "鞋子",
          extra,
          intent,
          selection,
          productImagePaths,
          mimicPath,
          mimeType: mimic.type || "video/mp4",
          videoPreset: preset,
          videoDurationSec,
          aspectRatio,
          visionModel,
          seedreamModel,
          seedanceModel,
        };
      }
    } else if (mode === "prompt") {
      if (category !== "提示词生成") return bad("category 参数错误（提示词生成）");
      const v = ensureFile(form.get("promptVideo"), "参考视频", MAX_VIDEO_BYTES);
      if (!v) return bad("请上传1个参考视频");
      if (!(v.type || "").includes("video")) return bad("参考视频格式不正确");
      const promptVideoPath = path.join(uploadDir, `prompt.mp4`);
      await saveWebFileToDisk(v, promptVideoPath);
      const bgm = String(form.get("bgm") ?? "").trim() || undefined;
      input = {
        mode: "prompt",
        category: "提示词生成",
        promptVideoPath,
        bgm,
        mimeType: v.type || "video/mp4",
        visionModel,
      };
    } else if (mode === "prompt_image") {
      if (category !== "提示词生成（图生提示词）") return bad("category 参数错误（图生提示词）");
      const extra = String(form.get("extra") ?? "").trim() || undefined;
      const imgFiles = form.getAll("promptImages").map((v) => ensureFile(v, "参考图", MAX_IMAGE_BYTES));
      const imgs = imgFiles.filter(Boolean) as File[];
      if (imgs.length < 1) return bad("请至少上传1张参考图片（最多5张）");
      if (imgs.length > 5) return bad("最多上传5张参考图片");

      const promptImagePaths: string[] = [];
      for (let i = 0; i < imgs.length; i++) {
        const f = imgs[i];
        const ext = f.type.includes("png") ? "png" : "jpg";
        const p = path.join(uploadDir, `prompt_img_${i + 1}.${ext}`);
        await saveWebFileToDisk(f, p);
        promptImagePaths.push(p);
      }
      input = {
        mode: "prompt_image",
        category: "提示词生成（图生提示词）",
        promptImagePaths,
        extra,
        mimeType: imgs[0]?.type || "image/*",
        visionModel,
      };
    } else {
      if (mode === "t2v") {
        if (category !== "文生视频") return bad("category 参数错误（文生视频）");
        const prompt = String(form.get("t2vPrompt") ?? "").trim();
        if (!prompt) return bad("请输入提示词");
        const presetValue = String(form.get("videoPreset") ?? "720p");
        const preset = presetValue as VideoOutputPreset;
        if (preset !== "720p" && preset !== "1080p") return bad("videoPreset 参数错误");
        const durValue = Number(form.get("videoDurationSec") ?? 0);
        if (![5, 7, 15, 30].includes(durValue)) return bad("videoDurationSec 仅支持 5/7/15/30");

        const imgFiles = form.getAll("t2vImages").map((v) => ensureFile(v, "参考图", MAX_IMAGE_BYTES));
        const imgs = imgFiles.filter(Boolean) as File[];
        if (imgs.length < 1) return bad("请至少上传1张参考图片（最多5张）");
        if (imgs.length > 5) return bad("最多上传5张参考图片");
        const t2vImagePaths: string[] = [];
        for (let i = 0; i < imgs.length; i++) {
          const f = imgs[i];
          const ext = f.type.includes("png") ? "png" : "jpg";
          const p = path.join(uploadDir, `t2v_${i + 1}.${ext}`);
          await saveWebFileToDisk(f, p);
          t2vImagePaths.push(p);
        }

        input = {
          mode: "t2v",
          category: "文生视频",
          t2vPrompt: prompt,
          t2vImagePaths,
          videoPreset: preset,
          videoDurationSec: durValue as 5 | 7 | 15 | 30,
          aspectRatio,
          mimeType: "video/mp4",
          seedanceModel,
        };
      } else {
        // t2i
        if (category !== "文生图") return bad("category 参数错误（文生图）");
        const prompt = String(form.get("t2iPrompt") ?? "").trim();
        if (!prompt) return bad("请输入提示词");
        const imgFiles = form.getAll("t2iImages").map((v) => ensureFile(v, "参考图", MAX_IMAGE_BYTES));
        const imgs = imgFiles.filter(Boolean) as File[];
        if (imgs.length < 3) return bad("请上传至少3张参考图片（最多5张）");
        if (imgs.length > 5) return bad("最多上传5张参考图片");
        const t2iImagePaths: string[] = [];
        for (let i = 0; i < imgs.length; i++) {
          const f = imgs[i];
          const ext = f.type.includes("png") ? "png" : "jpg";
          const p = path.join(uploadDir, `t2i_${i + 1}.${ext}`);
          await saveWebFileToDisk(f, p);
          t2iImagePaths.push(p);
        }
        input = {
          mode: "t2i",
          category: "文生图",
          t2iPrompt: prompt,
          t2iImagePaths,
          aspectRatio,
          mimeType: "image/png",
          seedreamModel,
        };
      }
    }

    const job = createJob(input);

    return NextResponse.json({ ok: true, job, quota });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "创建任务失败", quota },
      { status: 400 }
    );
  }
}

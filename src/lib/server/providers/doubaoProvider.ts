import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { nanoid } from "nanoid";
import { ensureDir, tmpDir } from "../fs";
import type { ShoeSwapProvider, SwapImageArgs, SwapVideoArgs } from "./types";
import type { NormalizedBox } from "../jobs/types";
import { probeVideo } from "../videoProbe";

const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArkErrorCode(raw: string): string | undefined {
  try {
    const j: unknown = JSON.parse(raw);
    if (!j || typeof j !== "object") return undefined;
    const o = j as Record<string, unknown>;
    const err = o.error;
    if (!err || typeof err !== "object") return undefined;
    const eo = err as Record<string, unknown>;
    return typeof eo.code === "string" ? eo.code : undefined;
  } catch {
    return undefined;
  }
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function pxBox(imgW: number, imgH: number, box: { x: number; y: number; w: number; h: number }) {
  const x = Math.round(clamp01(box.x) * imgW);
  const y = Math.round(clamp01(box.y) * imgH);
  const w = Math.round(clamp01(box.w) * imgW);
  const h = Math.round(clamp01(box.h) * imgH);
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

function expandBox(b: NormalizedBox, pad = 0.08): NormalizedBox {
  const x = clamp01(b.x - pad);
  const y = clamp01(b.y - pad);
  const w = clamp01(b.w + pad * 2);
  const h = clamp01(b.h + pad * 2);
  return { x, y, w, h };
}

function guessImageMimeByPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

async function fileToDataUrl(p: string, mime?: string) {
  const buf = await readFile(p);
  const m = mime ?? guessImageMimeByPath(p);
  return `data:${m};base64,${buf.toString("base64")}`;
}

async function arkJson<T>(urlPath: string, body: unknown): Promise<T> {
  const apiKey = mustEnv("ARK_API_KEY");
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(`${ARK_BASE_URL}${urlPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) return (await resp.json()) as T;

    const text = await resp.text().catch(() => "");
    const errCode = parseArkErrorCode(text);

    const overloaded =
      resp.status === 429 || resp.status === 503 || errCode === "ServerOverloaded" || errCode === "RateLimitExceeded";

    if (overloaded && attempt < maxRetries) {
      // 指数退避 + 抖动
      const base = 900 * 2 ** attempt;
      const jitter = Math.floor(Math.random() * 250);
      await sleep(base + jitter);
      continue;
    }

    if (overloaded) {
      throw new Error("平台繁忙（方舟服务过载），请稍后重试");
    }
    throw new Error(`方舟请求失败(${resp.status}): ${text || resp.statusText}`);
  }

  // unreachable
  throw new Error("平台繁忙（方舟服务过载），请稍后重试");
}

async function arkGetJson<T>(urlPath: string): Promise<T> {
  const apiKey = mustEnv("ARK_API_KEY");
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(`${ARK_BASE_URL}${urlPath}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (resp.ok) return (await resp.json()) as T;

    const text = await resp.text().catch(() => "");
    const errCode = parseArkErrorCode(text);

    const overloaded =
      resp.status === 429 || resp.status === 503 || errCode === "ServerOverloaded" || errCode === "RateLimitExceeded";
    if (overloaded && attempt < maxRetries) {
      const base = 900 * 2 ** attempt;
      const jitter = Math.floor(Math.random() * 250);
      await sleep(base + jitter);
      continue;
    }
    if (overloaded) {
      throw new Error("平台繁忙（方舟服务过载），请稍后重试");
    }
    throw new Error(`方舟请求失败(${resp.status}): ${text || resp.statusText}`);
  }

  throw new Error("平台繁忙（方舟服务过载），请稍后重试");
}

async function downloadToFile(url: string, outPath: string) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`下载生成结果失败(${resp.status})`);
  const ab = await resp.arrayBuffer();
  await ensureDir(path.dirname(outPath));
  await writeFile(outPath, Buffer.from(ab));
}

async function describeShoe(productImagePaths: string[]): Promise<string> {
  const visionModel = process.env.DOUBAO_VISION_MODEL ?? "doubao-seed-1-6-vision-250815";
  const imgs = await Promise.all(productImagePaths.map((p) => fileToDataUrl(p)));

  // 注意：该 vision 模型在你的账号下对 Responses API 可能无权限（你遇到过403）。
  // 这里改用 Chat Completions（OpenAI兼容）来做同样的视觉描述，避免权限问题。
  type ChatResp = {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const payload = {
    model: visionModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请你综合以下3张商品图，提取并输出“这双鞋”的细节描述，用于AI换鞋。要求：只描述鞋子本身，不要描述背景；描述要具体（颜色、材质、鞋型、鞋头、鞋帮高度、鞋带/魔术贴、logo位置、鞋底纹理/厚度、主要装饰）。输出为一段中文，80-180字。",
          },
          ...imgs.map((u) => ({ type: "image_url", image_url: { url: u } })),
        ],
      },
    ],
  };

  const r = await arkJson<ChatResp>("/chat/completions", payload);
  const txt = r.choices?.[0]?.message?.content?.trim();
  return txt || "一双与商品图一致的鞋子（外观、材质、颜色、logo与细节保持一致）";
}

async function detectShoes(imagePath: string): Promise<NormalizedBox[]> {
  const visionModel = process.env.DOUBAO_VISION_MODEL ?? "doubao-seed-1-6-vision-250815";
  const img = await fileToDataUrl(imagePath);

  // 用 vision chat 直接输出 bbox JSON（归一化 0..1）
  type ChatResp = { choices?: Array<{ message?: { content?: string } }> };
  const payload = {
    model: visionModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "请识别图片中所有“鞋子”（如果有两只鞋要输出两个框）。" +
              "只输出严格的 JSON 数组，不要输出任何解释或多余文本。" +
              "数组元素格式为：{\"x\":0.123,\"y\":0.234,\"w\":0.345,\"h\":0.456}，坐标与宽高都按图片归一化到[0,1]。" +
              "要求：框要完整覆盖鞋子本体与鞋子阴影，宁可稍大一点。",
          },
          { type: "image_url", image_url: { url: img } },
        ],
      },
    ],
  };
  const r = await arkJson<ChatResp>("/chat/completions", payload);
  const content = r.choices?.[0]?.message?.content?.trim() ?? "";
  try {
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    const out: NormalizedBox[] = [];
    for (const it of parsed) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      const x = typeof o.x === "number" ? o.x : NaN;
      const y = typeof o.y === "number" ? o.y : NaN;
      const w = typeof o.w === "number" ? o.w : NaN;
      const h = typeof o.h === "number" ? o.h : NaN;
      if (![x, y, w, h].every((n) => Number.isFinite(n))) continue;
      if (w <= 0 || h <= 0) continue;
      out.push({
        x: clamp01(x),
        y: clamp01(y),
        w: clamp01(w),
        h: clamp01(h),
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function seedreamI2I({
  prompt,
  images,
}: {
  prompt: string;
  images: string | string[];
}): Promise<string> {
  const model = mustEnv("DOUBAO_SEEDREAM_MODEL");
  type ImgResp = { data: Array<{ url?: string; b64_json?: string }> };
  const r = await arkJson<ImgResp>("/images/generations", {
    model,
    prompt,
    image: images,
    size: "2K",
    watermark: false,
    response_format: "url",
    sequential_image_generation: "disabled",
  });
  const url = r?.data?.[0]?.url;
  if (!url) throw new Error("Seedream 返回为空（未拿到图片URL）");
  return url;
}

async function seedreamWholeImage({
  prompt,
  baseImagePath,
  productImagePaths,
}: {
  prompt: string;
  baseImagePath: string;
  productImagePaths: string[];
}): Promise<Buffer> {
  const base = await fileToDataUrl(baseImagePath);
  const p1 = await fileToDataUrl(productImagePaths[0]);
  const p2 = await fileToDataUrl(productImagePaths[1]);
  const p3 = await fileToDataUrl(productImagePaths[2]);
  const url = await seedreamI2I({ prompt, images: [base, p1, p2, p3] });
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`下载生成结果失败(${resp.status})`);
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

async function seedanceI2V({
  prompt,
  firstFrame,
  resolution,
}: {
  prompt: string;
  firstFrame: string; // data url 或 http(s) url
  resolution: "720p" | "1080p";
}): Promise<{ videoUrl: string; lastFrameUrl?: string }> {
  const model = mustEnv("DOUBAO_SEEDANCE_MODEL");

  // Video Generation API：创建任务 → 轮询直到 succeeded → 拿 content.video_url
  type CreateTaskResp = { id: string };
  const create = await arkJson<CreateTaskResp>("/contents/generations/tasks", {
    model,
    content: [
      { type: "text", text: prompt },
      { type: "image_url", role: "first_frame", image_url: { url: firstFrame } },
    ],
    resolution,
    generate_audio: false,
    return_last_frame: true,
  });

  const taskId = create.id;
  if (!taskId) throw new Error("Seedance 创建任务失败（未返回任务ID）");

  type TaskResp = {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed" | "expired" | "cancelled";
    content?: { video_url?: string; last_frame_url?: string };
    error?: { message?: string };
  };

  const startedAt = Date.now();
  const timeoutMs = 5 * 60 * 1000; // 5分钟（MVP）
  while (true) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Seedance 生成超时（>5分钟）");
    const t = await arkGetJson<TaskResp>(`/contents/generations/tasks/${taskId}`);
    if (t.status === "succeeded") {
      const v = t.content?.video_url;
      if (!v) throw new Error("Seedance 任务成功但未返回 video_url");
      return { videoUrl: v, lastFrameUrl: t.content?.last_frame_url };
    }
    if (t.status === "failed" || t.status === "expired" || t.status === "cancelled") {
      throw new Error(`Seedance 任务失败：${t.error?.message ?? t.status}`);
    }
    // 简单轮询退避
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export const doubaoProvider: ShoeSwapProvider = {
  name: "doubao-ark",

  async swapImage(args: SwapImageArgs) {
    const outDir = tmpDir("outputs");
    await ensureDir(outDir);

    // 背景编辑：走整图生成（硬替换），避免任何 feather / 拼接边
    if (args.intent === "background") {
      const shoeDesc = await describeShoe(args.productImagePaths);
      const hasSelection = !!(args.selection && args.selection.length > 0);
      const coords = hasSelection
        ? `需要替换的鞋子区域（归一化bbox数组）：${JSON.stringify(args.selection)}`
        : "需要替换：图片中所有鞋子（无框选）。";

      const prompt = [
        "你是一名电商修图师。",
        `目标鞋子描述：${shoeDesc}`,
        hasSelection
          ? "任务：仅替换[图1]中 bbox 指定区域内的鞋子；bbox 以外的鞋子必须保持原样，不得改动。"
          : "任务：把[图1]中出现的所有鞋子替换为与[图2][图3][图4]一致的同款鞋子（外观、材质、颜色、logo与细节一致）。",
        coords,
        "同时执行额外需求（如果涉及背景/地面/地毯/地板替换，必须完全覆盖目标区域，不要出现渐变溶解边或半透明过渡）。",
        "要求：整体构图尽量保持不变；不要改变除鞋子与额外需求相关区域以外的物体；不要添加文字/水印。",
        args.extra?.trim() ? `额外需求：${args.extra.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const outPath = path.join(outDir, `image_bg_${nanoid()}.png`);
      const buf = await seedreamWholeImage({
        prompt,
        baseImagePath: args.mimicImagePath,
        productImagePaths: args.productImagePaths,
      });
      await sharp(buf).png().toFile(outPath);
      return { outputPath: outPath, mimeType: "image/png" };
    }

    // 1) 解析框选：框选多少个鞋，替换多少双；不框选则自动检测全部鞋子
    let boxes: NormalizedBox[] = (args.selection ?? []).filter(Boolean);
    if (boxes.length === 0) {
      boxes = await detectShoes(args.mimicImagePath);
    }
    if (boxes.length === 0) throw new Error("未检测到鞋子区域，请手动框选（尽量覆盖鞋子+阴影）");

    // 2) 用视觉模型把“鞋子外观”抽成文字（让生成更贴近商品）
    const shoeDesc = await describeShoe(args.productImagePaths);
    const product1 = await fileToDataUrl(args.productImagePaths[0]);
    const product2 = await fileToDataUrl(args.productImagePaths[1]);
    const product3 = await fileToDataUrl(args.productImagePaths[2]);

    // 3) 逐个区域替换（从原图开始，替换一次写回一次）
    let currentPath = args.mimicImagePath;

    for (const rawBox of boxes.map((b) => expandBox(b, 0.06))) {
      const mimic = sharp(currentPath);
      const meta = await mimic.metadata();
      if (!meta.width || !meta.height) throw new Error("无法读取模仿图尺寸");

      const box = pxBox(meta.width, meta.height, rawBox);
      // 增大 padding，让 crop 边界远离鞋子，降低拼接痕迹
      const padX = Math.round(box.w * 0.45);
      const padY = Math.round(box.h * 0.45);
      const crop = {
        left: Math.max(0, box.x - padX),
        top: Math.max(0, box.y - padY),
        width: Math.min(meta.width - Math.max(0, box.x - padX), box.w + padX * 2),
        height: Math.min(meta.height - Math.max(0, box.y - padY), box.h + padY * 2),
      };

      const cropBuf = await mimic.extract(crop).png().toBuffer();
      const cropDataUrl = `data:image/png;base64,${cropBuf.toString("base64")}`;

      const localBox = {
        x: ((box.x - crop.left) / crop.width).toFixed(3),
        y: ((box.y - crop.top) / crop.height).toFixed(3),
        w: (box.w / crop.width).toFixed(3),
        h: (box.h / crop.height).toFixed(3),
      };

      const prompt = [
        "你是一名电商精修师，正在做“换鞋”局部替换。",
        `任务：仅编辑[图1]中归一化坐标区域 x=${localBox.x}, y=${localBox.y}, w=${localBox.w}, h=${localBox.h} 内的鞋子。`,
        `把该区域内的原鞋子彻底移除并替换为与[图2][图3][图4]一致的同款鞋子：${shoeDesc}。`,
        "要求：保持[图1]除鞋子区域外完全不变；鞋子与场景透视/光照/阴影一致；边缘自然无痕；不要残留原鞋子的轮廓/鞋带/logo；不要添加文字、水印。",
        args.extra?.trim() ? `额外需求：${args.extra.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const url = await seedreamI2I({ prompt, images: [cropDataUrl, product1, product2, product3] });

      const patchPath = path.join(outDir, `patch_${nanoid()}.png`);
      await downloadToFile(url, patchPath);

      // resize + feather，降低边界拼接痕迹
      const resized = await sharp(patchPath).resize(crop.width, crop.height, { fit: "fill" }).png().toBuffer();
      // 仅用于“换鞋无痕”，背景编辑走整图生成（不会走到这）
      const feather = Math.max(10, Math.round(Math.min(crop.width, crop.height) * 0.06));
      const innerW = Math.max(1, crop.width - feather * 2);
      const innerH = Math.max(1, crop.height - feather * 2);
      const rx = Math.min(28, feather);
      const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}">
        <rect x="${feather}" y="${feather}" width="${innerW}" height="${innerH}" rx="${rx}" ry="${rx}" fill="white"/>
      </svg>`;
      const mask = await sharp(Buffer.from(maskSvg)).png().blur(Math.max(2, feather / 2)).toBuffer();
      const feathered = await sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();

      const nextPath = path.join(outDir, `step_${nanoid()}.png`);
      await sharp(currentPath).composite([{ input: feathered, left: crop.left, top: crop.top }]).png().toFile(nextPath);
      currentPath = nextPath;
    }

    return { outputPath: currentPath, mimeType: "image/png" };
  },

  async swapVideo(args: SwapVideoArgs) {
    const outDir = tmpDir("outputs");
    await ensureDir(outDir);
    const outPath = path.join(outDir, `video_${nanoid()}.mp4`);

    // 说明：你当前开通的是 Seedance 1.5-pro / 1.0-pro-fast（偏“生成”，不是“把输入视频逐帧无损替换(v2v)”）。
    // 我们的折中方案：先把模仿视频首帧“换鞋”成目标鞋子（用 Seedream i2i），再用这张首帧做 i2v 生成视频。

    const styleFramePath = path.join(outDir, `style_${nanoid()}.png`);
    // 提取首帧
    await new Promise<void>((resolve, reject) => {
      const p = spawn("ffmpeg", ["-y", "-i", args.mimicVideoPath, "-frames:v", "1", styleFramePath], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let err = "";
      p.stderr.on("data", (d: Buffer) => (err += d.toString()));
      p.on("error", reject);
      p.on("close", (code: number) => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg exited ${code}`))));
    });

    // 先把首帧换鞋（同图多框选：替换多双；不框选则自动检测）
    const shoeDesc = await describeShoe(args.productImagePaths);
    const frameMeta = await sharp(styleFramePath).metadata();
    if (!frameMeta.width || !frameMeta.height) throw new Error("无法读取视频首帧尺寸");
    const product1 = await fileToDataUrl(args.productImagePaths[0]);
    const product2 = await fileToDataUrl(args.productImagePaths[1]);
    const product3 = await fileToDataUrl(args.productImagePaths[2]);

    let swappedFramePath = styleFramePath;

    if (args.intent === "background") {
      const hasSelection = !!(args.selection && args.selection.length > 0);
      const coords = hasSelection
        ? `需要替换的鞋子区域（归一化bbox数组）：${JSON.stringify(args.selection)}`
        : "需要替换：图片中所有鞋子（无框选）。";
      const prompt = [
        "你是一名电商修图师。",
        hasSelection
          ? "任务：仅替换[图1]中 bbox 指定区域内的鞋子；bbox 以外的鞋子必须保持原样，不得改动。"
          : "任务：把[图1]中出现的所有鞋子替换为与[图2][图3][图4]一致的同款鞋子。",
        coords,
        "同时执行额外需求（如换背景/换地面/换地毯等必须完全覆盖，不要出现渐变溶解边）。",
        "要求：整体构图尽量保持不变；不要添加文字/水印。",
        args.extra?.trim() ? `额外需求：${args.extra.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const buf = await seedreamWholeImage({
        prompt,
        baseImagePath: styleFramePath,
        productImagePaths: args.productImagePaths,
      });
      swappedFramePath = path.join(outDir, `first_frame_bg_${nanoid()}.png`);
      await sharp(buf).png().toFile(swappedFramePath);
    } else {
      let boxes: NormalizedBox[] = (args.selection ?? []).filter(Boolean);
      if (boxes.length === 0) boxes = await detectShoes(styleFramePath);
      if (boxes.length === 0) throw new Error("未检测到鞋子区域，请手动框选（尽量覆盖鞋子+阴影）");

      for (const rawBox of boxes.map((b) => expandBox(b, 0.06))) {
        const box = pxBox(frameMeta.width, frameMeta.height, rawBox);
        const padX = Math.round(box.w * 0.45);
        const padY = Math.round(box.h * 0.45);
        const crop = {
          left: Math.max(0, box.x - padX),
          top: Math.max(0, box.y - padY),
          width: Math.min(frameMeta.width - Math.max(0, box.x - padX), box.w + padX * 2),
          height: Math.min(frameMeta.height - Math.max(0, box.y - padY), box.h + padY * 2),
        };
        const cropBuf = await sharp(swappedFramePath).extract(crop).png().toBuffer();
        const cropDataUrl = `data:image/png;base64,${cropBuf.toString("base64")}`;

        const localBox = {
          x: ((box.x - crop.left) / crop.width).toFixed(3),
          y: ((box.y - crop.top) / crop.height).toFixed(3),
          w: (box.w / crop.width).toFixed(3),
          h: (box.h / crop.height).toFixed(3),
        };

        const framePrompt = [
          "你是一名电商精修师，正在做“换鞋”局部替换。",
          `任务：仅编辑[图1]中归一化坐标区域 x=${localBox.x}, y=${localBox.y}, w=${localBox.w}, h=${localBox.h} 内的鞋子。`,
          `把该区域内的原鞋子彻底移除并替换为与[图2][图3][图4]一致的同款鞋子：${shoeDesc}。`,
          "要求：保持[图1]除鞋子区域外完全不变；鞋子与场景透视/光照/阴影一致；边缘自然无痕；不要残留原鞋子轮廓；不要添加文字、水印。",
          args.extra?.trim() ? `额外需求：${args.extra.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const patchUrl = await seedreamI2I({ prompt: framePrompt, images: [cropDataUrl, product1, product2, product3] });
        const patchPath = path.join(outDir, `frame_patch_${nanoid()}.png`);
        await downloadToFile(patchUrl, patchPath);
        const resized = await sharp(patchPath).resize(crop.width, crop.height, { fit: "fill" }).png().toBuffer();
        const feather = Math.max(10, Math.round(Math.min(crop.width, crop.height) * 0.06));
        const innerW = Math.max(1, crop.width - feather * 2);
        const innerH = Math.max(1, crop.height - feather * 2);
        const rx = Math.min(28, feather);
        const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}">
          <rect x="${feather}" y="${feather}" width="${innerW}" height="${innerH}" rx="${rx}" ry="${rx}" fill="white"/>
        </svg>`;
        const mask = await sharp(Buffer.from(maskSvg)).png().blur(Math.max(2, feather / 2)).toBuffer();
        const feathered = await sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();

        const nextFrame = path.join(outDir, `first_frame_${nanoid()}.png`);
        await sharp(swappedFramePath).composite([{ input: feathered, left: crop.left, top: crop.top }]).png().toFile(nextFrame);
        swappedFramePath = nextFrame;
      }
    }

    const firstFrameDataUrl = await fileToDataUrl(swappedFramePath, "image/png");

    const resolution = args.preset === "1080p" ? "1080p" : "720p";
    // 注意：Seedance 1.5-pro 的 i2v 可能不支持直接传 duration 参数（会报 InvalidParameter）。
    // 这里改为“多段生成 + 拼接 + 裁切”来满足 7/15/30 或等长输出需求。
    const targetSec = Math.min(30, Math.max(2, Math.round(Number(args.durationSec ?? 5))));
    const prompt = [
      "生成一段写实电商短视频。",
      "首帧必须与输入图片保持一致，并在后续镜头中保持同一双鞋（外观、颜色、材质、logo、鞋底细节一致）。",
      "镜头：轻微推进或环绕，运动自然；画面稳定；光照与首帧一致。",
      "要求：无声视频，不要背景音乐（BGM），不要任何音轨。",
      args.extra?.trim() ? `额外需求：${args.extra.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // 分段生成（默认每段约 5 秒，具体以 ffprobe 探测为准）
    const segments: string[] = [];
    let acc = 0;
    let nextFirstFrame: string = firstFrameDataUrl;
    const maxSegments = 8; // 最多拼到约40s（我们最终会裁到<=30s）

    for (let i = 0; i < maxSegments && acc < targetSec; i++) {
      const { videoUrl, lastFrameUrl } = await seedanceI2V({
        prompt,
        firstFrame: nextFirstFrame,
        resolution,
      });
      const segPath = path.join(outDir, `seg_${nanoid()}.mp4`);
      await downloadToFile(videoUrl, segPath);
      segments.push(segPath);

      const meta = await probeVideo(segPath);
      const d = meta.durationSec ? Math.max(0.1, meta.durationSec) : 5;
      acc += d;

      if (lastFrameUrl) nextFirstFrame = lastFrameUrl;
    }

    // ffmpeg concat + trim + 去音轨（防止模型输出任何音频轨）
    const listPath = path.join(outDir, `concat_${nanoid()}.txt`);
    const list = segments.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    await writeFile(listPath, list, "utf-8");

    const tmpConcat = path.join(outDir, `concat_${nanoid()}.mp4`);
    await new Promise<void>((resolve, reject) => {
      const p = spawn(
        "ffmpeg",
        ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", tmpConcat],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      let err = "";
      p.stderr.on("data", (d: Buffer) => (err += d.toString()));
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg exited ${code}`))));
    });

    await new Promise<void>((resolve, reject) => {
      const p = spawn(
        "ffmpeg",
        ["-y", "-i", tmpConcat, "-t", String(targetSec), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", outPath],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      let err = "";
      p.stderr.on("data", (d: Buffer) => (err += d.toString()));
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg exited ${code}`))));
    });

    return { outputPath: outPath, mimeType: "video/mp4" };
  },
};

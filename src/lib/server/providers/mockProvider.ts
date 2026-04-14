import path from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { nanoid } from "nanoid";
import { ensureDir, tmpDir } from "../fs";
import type { ShoeSwapProvider, SwapImageArgs, SwapVideoArgs } from "./types";

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

async function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += String(d)));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${cmd} exited with ${code}`));
    });
  });
}

export const mockProvider: ShoeSwapProvider = {
  name: "mock-provider",

  async swapImage(args: SwapImageArgs) {
    const selection = args.selection?.[0];
    if (!selection) throw new Error("当前为演示版 mock-provider：请框选至少一个鞋子区域");
    const outDir = tmpDir("outputs");
    await ensureDir(outDir);
    const outPath = path.join(outDir, `image_${nanoid()}.png`);

    const mimic = sharp(args.mimicImagePath);
    const meta = await mimic.metadata();
    if (!meta.width || !meta.height) throw new Error("无法读取模仿图尺寸");

    const box = pxBox(meta.width, meta.height, selection);

    const product0 = sharp(args.productImagePaths[0]).resize({
      width: box.w,
      height: box.h,
      fit: "cover",
    });

    // 轻微“霓虹”描边，让替换区域更明显（MVP占位：真实项目这里应由大模型完成无痕融合）
    const overlay = await product0
      .modulate({ brightness: 1.02, saturation: 1.08 })
      .png()
      .toBuffer();

    const result = mimic
      .composite([
        { input: overlay, left: box.x, top: box.y },
        {
          input: Buffer.from(
            `<svg width="${meta.width}" height="${meta.height}">
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stop-color="rgba(56,189,248,0.9)"/>
                  <stop offset="1" stop-color="rgba(167,139,250,0.9)"/>
                </linearGradient>
              </defs>
              <rect x="${box.x + 1}" y="${box.y + 1}" width="${Math.max(1, box.w - 2)}" height="${Math.max(
              1,
              box.h - 2
            )}" rx="10" ry="10" fill="none" stroke="url(#g)" stroke-width="2" opacity="0.9"/>
              <text x="${meta.width - 14}" y="${meta.height - 12}" text-anchor="end"
                font-family="monospace" font-size="12" fill="rgba(255,255,255,0.65)">
                DEMO · ShoeSwap
              </text>
            </svg>`
          ),
          top: 0,
          left: 0,
        },
      ])
      .png();

    await result.toFile(outPath);
    return { outputPath: outPath, mimeType: "image/png" };
  },

  async swapVideo(args: SwapVideoArgs) {
    const selection = args.selection?.[0];
    if (!selection) throw new Error("当前为演示版 mock-provider：请框选至少一个鞋子区域");
    const outDir = tmpDir("outputs");
    await ensureDir(outDir);
    const outPath = path.join(outDir, `video_${nanoid()}.mp4`);

    // 将产品图转为png以供ffmpeg overlay
    const overlayPng = path.join(outDir, `overlay_${nanoid()}.png`);
    await sharp(args.productImagePaths[0]).png().toFile(overlayPng);

    // 用 ffprobe 获取输入视频宽高
    const probeJsonPath = path.join(outDir, `probe_${nanoid()}.json`);
    await run("bash", [
      "-lc",
      `ffprobe -v quiet -print_format json -show_streams -show_format "${args.mimicVideoPath}" > "${probeJsonPath}"`,
    ]);
    const probeRaw = await readFile(probeJsonPath, "utf8");
    const probe: unknown = JSON.parse(probeRaw);
    const probeObj = probe && typeof probe === "object" ? (probe as Record<string, unknown>) : null;
    const streams = Array.isArray(probeObj?.streams) ? (probeObj!.streams as unknown[]) : [];
    const vStream = streams.find((s) => {
      if (!s || typeof s !== "object") return false;
      const o = s as Record<string, unknown>;
      return o.codec_type === "video";
    }) as Record<string, unknown> | undefined;
    const inW = Number(vStream?.width);
    const inH = Number(vStream?.height);
    if (!inW || !inH) throw new Error("无法读取模仿视频尺寸");

    const box = pxBox(inW, inH, selection);

    const preset = args.preset;
    const outW = preset === "1080p" ? 1920 : 1280;
    const outH = preset === "1080p" ? 1080 : 720;

    // 先overlay，再统一scale到目标分辨率并pad；固定30fps（不向用户暴露）
    const filter = [
      `[1:v]scale=${box.w}:${box.h}[shoe]`,
      `[0:v][shoe]overlay=${box.x}:${box.y}:format=auto[tmp]`,
      `[tmp]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:color=black@0.0,` +
        `drawtext=text='DEMO · ShoeSwap':x=w-16:y=h-16:fontcolor=white@0.55:fontsize=14:font='DejaVuSansMono'[v]`,
    ].join(";");

    await run("ffmpeg", [
      "-y",
      "-i",
      args.mimicVideoPath,
      "-i",
      overlayPng,
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "0:a?",
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      outPath,
    ]);

    return { outputPath: outPath, mimeType: "video/mp4" };
  },
};

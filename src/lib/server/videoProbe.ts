import { spawn } from "node:child_process";

export type VideoProbe = {
  durationSec?: number;
  width?: number;
  height?: number;
};

export async function probeVideo(filePath: string): Promise<VideoProbe> {
  const args = [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath,
  ];

  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(err || `ffprobe exited with ${code}`));
      try {
        const json: unknown = JSON.parse(out);
        const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
        const streams = Array.isArray(obj?.streams) ? (obj!.streams as unknown[]) : [];
        const v = streams.find((s) => {
          if (!s || typeof s !== "object") return false;
          const o = s as Record<string, unknown>;
          return o.codec_type === "video";
        }) as Record<string, unknown> | undefined;
        const format = obj?.format && typeof obj.format === "object" ? (obj.format as Record<string, unknown>) : null;
        const durationSec = format?.duration ? Number(format.duration) : undefined;
        resolve({
          durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
          width: v?.width ? Number(v.width) : undefined,
          height: v?.height ? Number(v.height) : undefined,
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

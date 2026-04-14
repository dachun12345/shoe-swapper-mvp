import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function ensureDir(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

export function tmpDir(...parts: string[]) {
  // 在 Vercel / Serverless 环境里，代码目录（如 /var/task）是只读的，只能写 /tmp
  // 本地开发仍然使用项目内 .tmp 方便排查
  const base = process.env.VERCEL ? os.tmpdir() : path.join(process.cwd(), ".tmp");
  return path.join(base, "shoe-swapper-mvp", ...parts);
}

export async function saveWebFileToDisk(file: File, outPath: string) {
  const ab = await file.arrayBuffer();
  await ensureDir(path.dirname(outPath));
  await writeFile(outPath, Buffer.from(ab));
}

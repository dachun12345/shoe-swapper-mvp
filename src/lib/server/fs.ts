import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

export function tmpDir(...parts: string[]) {
  return path.join(process.cwd(), ".tmp", ...parts);
}

export async function saveWebFileToDisk(file: File, outPath: string) {
  const ab = await file.arrayBuffer();
  await ensureDir(path.dirname(outPath));
  await writeFile(outPath, Buffer.from(ab));
}


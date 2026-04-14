import { nanoid } from "nanoid";
import { getProvider } from "../providers";
import type { CreateJobInput, JobRecord, JobStatus } from "./types";
import { ensureDir, tmpDir } from "../fs";
import { unlink } from "node:fs/promises";

const jobs = new Map<string, JobRecord>();
const queue: string[] = [];
let workerStarted = false;

const TTL_MS = Number(process.env.JOB_TTL_MS ?? 15 * 60 * 1000); // 15分钟

function now() {
  return Date.now();
}

function setJob(jobId: string, patch: Partial<JobRecord>) {
  const prev = jobs.get(jobId);
  if (!prev) return;
  jobs.set(jobId, { ...prev, ...patch, updatedAt: now() });
}

async function safeUnlink(p?: string) {
  if (!p) return;
  try {
    await unlink(p);
  } catch {}
}

async function processJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  try {
    setJob(jobId, { status: "processing", progress: 10 });
    await ensureDir(tmpDir("outputs"));

    const provider = getProvider(process.env.DEFAULT_PROVIDER);
    const input = job.input;

    if (input.mode === "image") {
      setJob(jobId, { progress: 35 });
      const res = await provider.swapImage({
        productImagePaths: input.productImagePaths,
        mimicImagePath: input.mimicPath,
        selection: input.selection ?? null,
        extra: input.extra,
        intent: input.intent,
      });
      setJob(jobId, {
        status: "succeeded",
        progress: 100,
        outputPath: res.outputPath,
        outputMimeType: res.mimeType,
      });
      return;
    }

    if (input.mode === "video") {
      setJob(jobId, { progress: 25 });
      const res = await provider.swapVideo({
        productImagePaths: input.productImagePaths,
        mimicVideoPath: input.mimicPath,
        selection: input.selection ?? null,
        extra: input.extra,
        preset: input.videoPreset ?? "720p",
        intent: input.intent,
        durationSec: input.videoDurationSec,
      });
      setJob(jobId, {
        status: "succeeded",
        progress: 100,
        outputPath: res.outputPath,
        outputMimeType: res.mimeType,
      });
      return;
    }

    throw new Error("未知任务类型");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    setJob(jobId, { status: "failed", progress: 100, error: msg });
  }
}

async function workerLoop() {
  if (queue.length === 0) return;
  const jobId = queue.shift();
  if (!jobId) return;
  await processJob(jobId);
  // 继续下一个
  setImmediate(workerLoop);
}

function startCleanupTimer() {
  // 每60秒清一次过期文件与任务记录
  setInterval(async () => {
    const t = now();
    for (const [id, job] of jobs.entries()) {
      if (job.expiresAt > t) continue;
      await safeUnlink(job.outputPath);
      // 输入文件也可以删除（这里省略；MVP默认只清结果）
      jobs.delete(id);
    }
  }, 60_000).unref();
}

export function startWorkerIfNeeded() {
  if (workerStarted) return;
  workerStarted = true;
  startCleanupTimer();
}

export function createJob(input: CreateJobInput): JobRecord {
  startWorkerIfNeeded();
  const id = nanoid();
  const t = now();
  const job: JobRecord = {
    id,
    createdAt: t,
    updatedAt: t,
    status: "queued",
    progress: 0,
    input,
    expiresAt: t + TTL_MS,
  };
  jobs.set(id, job);
  queue.push(id);
  setImmediate(workerLoop);
  return job;
}

export function getJob(id: string): JobRecord | undefined {
  startWorkerIfNeeded();
  return jobs.get(id);
}

export function listJobs(): JobRecord[] {
  startWorkerIfNeeded();
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function updateJobStatus(id: string, status: JobStatus) {
  setJob(id, { status });
}

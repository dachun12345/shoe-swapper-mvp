export type JobMode = "image" | "video";

export type NormalizedBox = {
  // [0..1]
  x: number;
  y: number;
  w: number;
  h: number;
};

export type VideoOutputPreset = "720p" | "1080p";
export type VideoOutputDurationSec = 7 | 15 | 30 | number;

export type EditIntent = "shoe" | "background";

export type CreateJobInput = {
  mode: JobMode;
  category: "鞋子";
  extra: string;
  // shoe：换鞋无痕；background：涉及换背景/换地板等，走“硬替换/整图生成”避免溶解边
  intent: EditIntent;
  // null / []：表示不框选，走“自动检测鞋子并全部替换”
  selection: NormalizedBox[] | null;
  productImagePaths: string[]; // 3
  mimicPath: string; // image or video
  videoPreset?: VideoOutputPreset;
  // 视频输出时长：≤30s 时默认等于原视频时长；>30s 时用户可选 7/15/30
  videoDurationSec?: VideoOutputDurationSec;
  mimeType: string;
};

export type JobStatus = "queued" | "processing" | "succeeded" | "failed";

export type JobRecord = {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: JobStatus;
  progress: number; // 0..100
  error?: string;
  input: CreateJobInput;
  outputPath?: string;
  outputMimeType?: string;
  expiresAt: number; // TTL cleanup
};

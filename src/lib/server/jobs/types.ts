export type JobMode = "image" | "video" | "prompt" | "prompt_image" | "t2v" | "t2i";

export type AspectRatio =
  | "3:4"
  | "4:3"
  | "9:16"
  | "16:9"
  | "1:1"
  | "4:5" // 推荐：小红书/电商
  | "2:3" // 推荐：人像/商品竖图
  | "21:9"; // 推荐：电影感横屏

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

export type CreateJobInput =
  | {
      mode: "image";
      category: "鞋子";
      extra: string;
      intent: EditIntent;
      selection: NormalizedBox[] | null;
      productImagePaths: string[]; // 3..5
      mimicPath: string; // image
      aspectRatio?: AspectRatio;
      mimeType: string;
      // per-request model override（可选）
      visionModel?: string;
      seedreamModel?: string;
    }
  | {
      mode: "video";
      category: "鞋子";
      extra: string;
      intent: EditIntent;
      selection: NormalizedBox[] | null;
      productImagePaths: string[]; // 3..5
      mimicPath: string; // video
      mimeType: string;
      videoPreset: VideoOutputPreset;
      videoDurationSec: VideoOutputDurationSec;
      aspectRatio?: AspectRatio;
      visionModel?: string;
      seedreamModel?: string;
      seedanceModel?: string;
    }
  | {
      mode: "prompt";
      category: "提示词生成";
      promptVideoPath: string;
      bgm?: string;
      mimeType: string;
      visionModel?: string;
    }
  | {
      mode: "prompt_image";
      category: "提示词生成（图生提示词）";
      promptImagePaths: string[]; // 1..5
      extra?: string;
      mimeType: string; // image/*
      visionModel?: string;
    }
  | {
      mode: "t2v";
      category: "文生视频";
      t2vPrompt: string;
      t2vImagePaths: string[]; // 1..5
      videoPreset: VideoOutputPreset;
      videoDurationSec: 5 | 7 | 15 | 30;
      aspectRatio?: AspectRatio;
      mimeType: string;
      seedanceModel?: string;
    }
  | {
      mode: "t2i";
      category: "文生图";
      t2iPrompt: string;
      t2iImagePaths: string[]; // 3..5
      aspectRatio?: AspectRatio;
      mimeType: string; // image/png
      seedreamModel?: string;
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
  // prompt 任务输出
  outputText?: string;
  outputData?: unknown;
  expiresAt: number; // TTL cleanup
};

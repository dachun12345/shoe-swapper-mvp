import type { AspectRatio, EditIntent, NormalizedBox, VideoOutputDurationSec, VideoOutputPreset } from "../jobs/types";

export type SwapImageArgs = {
  productImagePaths: string[];
  mimicImagePath: string;
  // null / []：表示不框选，provider 自己做“自动检测鞋子并全部替换”
  selection: NormalizedBox[] | null;
  extra: string;
  intent: EditIntent;
  aspectRatio?: AspectRatio;
  visionModel?: string;
  seedreamModel?: string;
};

export type SwapVideoArgs = {
  productImagePaths: string[];
  mimicVideoPath: string;
  selection: NormalizedBox[] | null;
  extra: string;
  preset: VideoOutputPreset;
  intent: EditIntent;
  durationSec?: VideoOutputDurationSec;
  aspectRatio?: AspectRatio;
  visionModel?: string;
  seedreamModel?: string;
  seedanceModel?: string;
};

export type ProviderResult = {
  outputPath: string;
  mimeType: string;
};

export type PromptFromVideoArgs = {
  promptVideoPath: string;
  bgm?: string;
  visionModel?: string;
};

export type PromptFromVideoResult = {
  outputText: string;
  outputData?: unknown;
};

export type PromptFromImageArgs = {
  promptImagePaths: string[]; // 1..5
  extra?: string;
  visionModel?: string;
};

export type PromptFromImageResult = {
  outputText: string;
  outputData?: unknown;
};

export type TextToVideoArgs = {
  prompt: string;
  imagePaths: string[]; // 1..5
  preset: VideoOutputPreset;
  durationSec: 5 | 7 | 15 | 30;
  aspectRatio?: AspectRatio;
  seedanceModel?: string;
};

export type TextToImageArgs = {
  prompt: string;
  imagePaths: string[]; // 3..5 (reference)
  aspectRatio?: AspectRatio;
  seedreamModel?: string;
};

export interface ShoeSwapProvider {
  name: string;
  swapImage(args: SwapImageArgs): Promise<ProviderResult>;
  swapVideo(args: SwapVideoArgs): Promise<ProviderResult>;
  promptFromVideo(args: PromptFromVideoArgs): Promise<PromptFromVideoResult>;
  promptFromImage(args: PromptFromImageArgs): Promise<PromptFromImageResult>;
  textToVideo(args: TextToVideoArgs): Promise<ProviderResult>;
  textToImage(args: TextToImageArgs): Promise<ProviderResult>;
}

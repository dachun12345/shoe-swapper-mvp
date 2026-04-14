import type { EditIntent, NormalizedBox, VideoOutputDurationSec, VideoOutputPreset } from "../jobs/types";

export type SwapImageArgs = {
  productImagePaths: string[];
  mimicImagePath: string;
  // null / []：表示不框选，provider 自己做“自动检测鞋子并全部替换”
  selection: NormalizedBox[] | null;
  extra: string;
  intent: EditIntent;
};

export type SwapVideoArgs = {
  productImagePaths: string[];
  mimicVideoPath: string;
  selection: NormalizedBox[] | null;
  extra: string;
  preset: VideoOutputPreset;
  intent: EditIntent;
  durationSec?: VideoOutputDurationSec;
};

export type ProviderResult = {
  outputPath: string;
  mimeType: string;
};

export interface ShoeSwapProvider {
  name: string;
  swapImage(args: SwapImageArgs): Promise<ProviderResult>;
  swapVideo(args: SwapVideoArgs): Promise<ProviderResult>;
}

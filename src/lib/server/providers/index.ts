import type { ShoeSwapProvider } from "./types";
import { mockProvider } from "./mockProvider";
import { doubaoProvider } from "./doubaoProvider";

// 这里就是“多大模型口子”：后续你给任何模型API，我会新增 provider 并注册到这里，
// 然后通过环境变量/请求参数切换 provider。
const providers: Record<string, ShoeSwapProvider> = {
  [mockProvider.name]: mockProvider,
  [doubaoProvider.name]: doubaoProvider,
};

export function getProvider(name?: string | null): ShoeSwapProvider {
  if (name && providers[name]) return providers[name];
  // 默认provider：质量优先时这里会切到你指定的最强模型（当前MVP先用mock占位）
  return mockProvider;
}

"use client";

import * as React from "react";
import { BoxSelector, type NormalizedBox } from "@/components/BoxSelector";
import { Badge, Button, Card, Input, ProgressBar, Select, Textarea } from "@/components/ui";

type JobStatus = "queued" | "processing" | "succeeded" | "failed";
type Job = {
  id: string;
  status: JobStatus;
  progress: number;
  error?: string;
  outputMimeType?: string;
  outputText?: string;
  outputData?: unknown;
};

type SectionKey = "shoot" | "promptVideo" | "promptImage" | "t2v" | "t2i";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

const MODEL_OPTIONS = {
  seedream: [
    { id: "doubao-seedream-5-0-260128", label: "Seedream 5.0 lite" },
    { id: "doubao-seedream-4-5-250115", label: "Seedream 4.5" },
  ],
  seedance: [
    { id: "doubao-seedance-1-5-pro-251215", label: "Seedance 1.5-pro" },
    { id: "doubao-seedance-1-0-pro-fast-250615", label: "Seedance 1.0-pro-fast" },
  ],
  vision: [
    { id: "doubao-1-5-vision-pro-32k-250115", label: "Doubao 1.5 Vision Pro" },
    { id: "doubao-seed-1-6-vision-250815", label: "Seed 1.6 Vision" },
  ],
} as const;

const ASPECT_OPTIONS = [
  { id: "3:4", label: "3:4" },
  { id: "4:3", label: "4:3" },
  { id: "9:16", label: "9:16" },
  { id: "16:9", label: "16:9" },
  { id: "1:1", label: "1:1" },
  // 推荐 3 个
  { id: "4:5", label: "4:5（推荐）" },
  { id: "2:3", label: "2:3（推荐）" },
  { id: "21:9", label: "21:9（推荐）" },
] as const;

const quickPrompts = [
  "换纯白背景（棚拍感）",
  "改成浅灰渐变背景",
  "地毯换成原木地板",
  "背景虚化，更突出产品",
  "整体更干净：去杂物/去阴影",
  "增加冷光科技感（更高级）",
  "提升清晰度与细节（更锐利）",
  "加轻微镜面反射地面",
] as const;

const t2vNeedExamples = [
  "视频中的鞋子必须使用我上传参考图里的鞋（颜色/材质/logo/鞋底纹理一致）",
  "镜头多给鞋子特写：鞋头、鞋侧、鞋底纹理、上脚走路展示",
  "场景保持不变，只调整鞋子与鞋子细节，不要改衣服/人物脸/背景",
  "画面更像广告片：干净高级、灯光更均匀、质感更清晰",
  "不要字幕/水印/贴纸/品牌乱入，不要出现额外的鞋款",
] as const;

const t2iNeedExamples = [
  "把我的图片中的鞋子用作图片中的其中一双鞋子（外观细节一致）",
  "画面更像电商主图：背景干净、光线均匀、质感清晰",
  "只出现一双鞋，不要出现多双鞋或重复鞋",
  "不要文字/水印/Logo 乱入，不要贴纸，不要字幕",
  "风格：高端极简、科技感冷光、细节锐利",
] as const;

function inferIntent(text: string): "shoe" | "background" {
  const t = (text || "").toLowerCase();
  const hit =
    /背景|地毯|地板|地面|纯白|渐变|虚化|去杂物|去阴影|镜面反射/.test(t) ||
    /background|floor|carpet|blur|gradient|shadow/.test(t);
  return hit ? "background" : "shoe";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function fileOk(file: File, maxBytes: number) {
  return file.size <= maxBytes;
}

function StatusBadge({ s }: { s: JobStatus }) {
  if (s === "succeeded") return <Badge tone="ok">已完成</Badge>;
  if (s === "failed") return <Badge tone="warn">失败</Badge>;
  if (s === "processing") return <Badge>生成中</Badge>;
  return <Badge>排队中</Badge>;
}

async function copyTextToClipboard(text: string) {
  // 1) 优先使用 Clipboard API（可能在 http / 权限不足时失败）
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // ignore & fallback
  }
  // 2) fallback：execCommand
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "true");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("复制失败：浏览器不允许写入剪贴板");
}

export default function Home() {
  // auth
  const [inviteCode, setInviteCode] = React.useState<string | null>(null);
  const [inviteInput, setInviteInput] = React.useState("");
  const [authErr, setAuthErr] = React.useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = React.useState<number>(1000);
  const [quotaRemaining, setQuotaRemaining] = React.useState<number | null>(null);

  // navigation
  const [section, setSection] = React.useState<SectionKey>("shoot");

  // shared UI state
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [taskToast, setTaskToast] = React.useState<string | null>(null);
  const [job, setJob] = React.useState<Job | null>(null);

  // model selections (per section)
  const [seedreamModel, setSeedreamModel] = React.useState<string>(MODEL_OPTIONS.seedream[0].id);
  const [visionModel, setVisionModel] = React.useState<string>(MODEL_OPTIONS.vision[0].id);
  const [seedanceModelT2V, setSeedanceModelT2V] = React.useState<string>(MODEL_OPTIONS.seedance[0].id);
  const [seedreamModelT2I, setSeedreamModelT2I] = React.useState<string>(MODEL_OPTIONS.seedream[0].id);

  // aspect ratio (per section)
  const [aspectShoot, setAspectShoot] = React.useState<string>("1:1");
  const [aspectT2V, setAspectT2V] = React.useState<string>("9:16");
  const [aspectT2I, setAspectT2I] = React.useState<string>("1:1");

  // --- 拍摄参考 / 视频参考（换鞋） ---
  const [extra, setExtra] = React.useState("");
  const intent = React.useMemo(() => inferIntent(extra), [extra]);
  const [productImages, setProductImages] = React.useState<File[]>([]);
  const [productPreviewUrls, setProductPreviewUrls] = React.useState<string[]>([]);
  const [mimicImage, setMimicImage] = React.useState<File | null>(null);
  const [mimicPreviewUrl, setMimicPreviewUrl] = React.useState<string | null>(null);
  const [selections, setSelections] = React.useState<NormalizedBox[]>([]);

  // --- 提示词生成（视频→prompt） ---
  const [promptVideo, setPromptVideo] = React.useState<File | null>(null);
  const [promptVideoPreviewUrl, setPromptVideoPreviewUrl] = React.useState<string | null>(null);
  const [bgmInputVideo, setBgmInputVideo] = React.useState("");

  // --- 提示词生成（图→prompt） ---
  const [promptImages, setPromptImages] = React.useState<File[]>([]);
  const [promptImagePreviews, setPromptImagePreviews] = React.useState<string[]>([]);
  const [promptImageNeeds, setPromptImageNeeds] = React.useState("");

  // --- 文生视频（prompt→video） ---
  const [t2vPrompt, setT2vPrompt] = React.useState("");
  const [t2vNeeds, setT2vNeeds] = React.useState("");
  const [t2vImages, setT2vImages] = React.useState<File[]>([]);
  const [t2vImagePreviews, setT2vImagePreviews] = React.useState<string[]>([]);
  const [t2vPreset, setT2vPreset] = React.useState<"720p" | "1080p">("720p");
  const [t2vDuration, setT2vDuration] = React.useState<5 | 7 | 15 | 30>(7);

  // --- 文生图（prompt→image） ---
  const [t2iPrompt, setT2iPrompt] = React.useState("");
  const [t2iNeeds, setT2iNeeds] = React.useState("");
  const [t2iImages, setT2iImages] = React.useState<File[]>([]);
  const [t2iImagePreviews, setT2iImagePreviews] = React.useState<string[]>([]);

  // results preview
  const [resultPreviewUrl, setResultPreviewUrl] = React.useState<string | null>(null);
  const [resultPreviewMime, setResultPreviewMime] = React.useState<string | null>(null);

  // cleanup on leave
  React.useEffect(() => {
    const onBeforeUnload = () => {
      if (mimicPreviewUrl) URL.revokeObjectURL(mimicPreviewUrl);
      for (const u of productPreviewUrls) URL.revokeObjectURL(u);
      if (promptVideoPreviewUrl) URL.revokeObjectURL(promptVideoPreviewUrl);
      for (const u of promptImagePreviews) URL.revokeObjectURL(u);
      for (const u of t2vImagePreviews) URL.revokeObjectURL(u);
      for (const u of t2iImagePreviews) URL.revokeObjectURL(u);
      if (resultPreviewUrl) URL.revokeObjectURL(resultPreviewUrl);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [mimicPreviewUrl, productPreviewUrls, promptVideoPreviewUrl, promptImagePreviews, t2vImagePreviews, t2iImagePreviews, resultPreviewUrl]);

  // product thumbs
  React.useEffect(() => {
    for (const u of productPreviewUrls) URL.revokeObjectURL(u);
    const next = productImages.map((f) => URL.createObjectURL(f));
    setProductPreviewUrls(next);
    return () => {
      for (const u of next) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productImages]);

  // t2v thumbs
  React.useEffect(() => {
    for (const u of t2vImagePreviews) URL.revokeObjectURL(u);
    const next = t2vImages.map((f) => URL.createObjectURL(f));
    setT2vImagePreviews(next);
    return () => {
      for (const u of next) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t2vImages]);

  // prompt image thumbs
  React.useEffect(() => {
    for (const u of promptImagePreviews) URL.revokeObjectURL(u);
    const next = promptImages.map((f) => URL.createObjectURL(f));
    setPromptImagePreviews(next);
    return () => {
      for (const u of next) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptImages]);

  // t2i thumbs
  React.useEffect(() => {
    for (const u of t2iImagePreviews) URL.revokeObjectURL(u);
    const next = t2iImages.map((f) => URL.createObjectURL(f));
    setT2iImagePreviews(next);
    return () => {
      for (const u of next) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t2iImages]);

  // auto-hide toast
  React.useEffect(() => {
    if (!taskToast) return;
    const t = window.setTimeout(() => setTaskToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [taskToast]);

  // poll job
  React.useEffect(() => {
    if (!inviteCode || !job?.id) return;
    if (job.status === "succeeded" || job.status === "failed") return;
    const t = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/jobs/${job.id}`, { headers: { "x-invite-code": inviteCode } });
        const j = await r.json().catch(() => null);
        if (j?.ok && j.job) setJob(j.job);
      } catch {}
    }, 900);
    return () => window.clearInterval(t);
  }, [inviteCode, job?.id, job?.status]);

  // fetch result preview (image/video jobs)
  React.useEffect(() => {
    if (!inviteCode || !job?.id) return;
    if (job.status !== "succeeded") return;
    if (section === "promptVideo" || section === "promptImage") return; // prompt job uses outputText
    if (resultPreviewUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/download/${job.id}`, { headers: { "x-invite-code": inviteCode } });
        if (!r.ok) return;
        const blob = await r.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setResultPreviewUrl(url);
        setResultPreviewMime(blob.type || job.outputMimeType || null);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteCode, job?.id, job?.status, job?.outputMimeType, section, resultPreviewUrl]);

  async function doLogin() {
    setAuthErr(null);
    setBusy(true);
    try {
      const r = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: inviteInput }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "登录失败");
      setInviteCode(j.inviteCode);
      setDailyLimit(j.dailyLimit ?? 1000);
      setQuotaRemaining(null);
    } catch (e: unknown) {
      setAuthErr(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  function resetAllForSection(next: SectionKey) {
    setSection(next);
    setErr(null);
    setJob(null);
    setSelections([]);
    setExtra("");

    if (mimicPreviewUrl) URL.revokeObjectURL(mimicPreviewUrl);
    setMimicPreviewUrl(null);
    setMimicImage(null);

    if (promptVideoPreviewUrl) URL.revokeObjectURL(promptVideoPreviewUrl);
    setPromptVideo(null);
    setPromptVideoPreviewUrl(null);
    setBgmInputVideo("");

    for (const u of promptImagePreviews) URL.revokeObjectURL(u);
    setPromptImages([]);
    setPromptImagePreviews([]);
    setPromptImageNeeds("");

    setT2vPrompt("");
    setT2vNeeds("");
    setT2vImages([]);
    setT2vPreset("720p");
    setT2vDuration(7);

    setT2iPrompt("");
    setT2iNeeds("");
    setT2iImages([]);

    setAspectShoot("1:1");
    setAspectT2V("9:16");
    setAspectT2I("1:1");

    if (resultPreviewUrl) URL.revokeObjectURL(resultPreviewUrl);
    setResultPreviewUrl(null);
    setResultPreviewMime(null);
  }

  async function submit() {
    if (!inviteCode) return;
    setErr(null);
    setBusy(true);

    try {
      setTaskToast("任务已提交，开始生成…");
      const fd = new FormData();

      if (section === "shoot") {
        if (productImages.length < 3 || productImages.length > 5) throw new Error("请上传3~5张产品图（不同角度更好）");
        for (const f of productImages) {
          if (!fileOk(f, MAX_IMAGE_BYTES)) throw new Error(`产品图超过10MB：${f.name}（${formatBytes(f.size)}）`);
        }
        if (!mimicImage) throw new Error("请上传1张模仿图");
        if (!fileOk(mimicImage, MAX_IMAGE_BYTES)) throw new Error(`模仿图超过10MB：${mimicImage.name}`);

        fd.set("mode", "image");
        fd.set("category", "鞋子");
        fd.set("extra", extra);
        fd.set("intent", intent);
        fd.set("selection", JSON.stringify(selections));

        // model pickers
        fd.set("seedreamModel", seedreamModel);
        fd.set("visionModel", visionModel);
        fd.set("aspectRatio", aspectShoot);

        productImages.forEach((f) => fd.append("productImages", f));
        if (mimicImage) fd.set("mimicImage", mimicImage);
      }

      if (section === "promptVideo") {
        if (!promptVideo) throw new Error("请上传1个参考视频");
        if (!fileOk(promptVideo, MAX_VIDEO_BYTES)) throw new Error(`参考视频超过60MB：${promptVideo.name}`);
        fd.set("mode", "prompt");
        fd.set("category", "提示词生成");
        fd.set("visionModel", visionModel);
        fd.set("bgm", bgmInputVideo);
        fd.set("promptVideo", promptVideo);
      }

      if (section === "promptImage") {
        if (promptImages.length === 0) throw new Error("请至少上传1张参考图片（最多5张）");
        for (const f of promptImages) {
          if (!fileOk(f, MAX_IMAGE_BYTES)) throw new Error(`参考图超过10MB：${f.name}（${formatBytes(f.size)}）`);
        }
        fd.set("mode", "prompt_image");
        fd.set("category", "提示词生成（图生提示词）");
        fd.set("visionModel", visionModel);
        promptImages.slice(0, 5).forEach((f) => fd.append("promptImages", f));
        // 额外需求目前直接拼到模型提示词里（不改后端字段）
        if (promptImageNeeds.trim()) fd.set("extra", promptImageNeeds.trim());
      }

      if (section === "t2v") {
        if (!t2vPrompt.trim()) throw new Error("请输入提示词");
        if (t2vImages.length === 0) throw new Error("请至少上传1张参考图片（最多5张）");
        for (const f of t2vImages) {
          if (!fileOk(f, MAX_IMAGE_BYTES)) throw new Error(`参考图超过10MB：${f.name}（${formatBytes(f.size)}）`);
        }
        fd.set("mode", "t2v");
        fd.set("category", "文生视频");
        fd.set("seedanceModel", seedanceModelT2V);
        const finalPrompt = [
          t2vPrompt.trim(),
          t2vNeeds.trim() ? `额外需求：\n${t2vNeeds.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        fd.set("t2vPrompt", finalPrompt);
        fd.set("videoPreset", t2vPreset);
        fd.set("videoDurationSec", String(t2vDuration));
        fd.set("aspectRatio", aspectT2V);
        t2vImages.slice(0, 5).forEach((f) => fd.append("t2vImages", f));
      }

      if (section === "t2i") {
        if (!t2iPrompt.trim()) throw new Error("请输入提示词");
        if (t2iImages.length < 3) throw new Error("请上传至少3张参考图片（最多5张）");
        for (const f of t2iImages) {
          if (!fileOk(f, MAX_IMAGE_BYTES)) throw new Error(`参考图超过10MB：${f.name}（${formatBytes(f.size)}）`);
        }
        const finalPrompt = [t2iPrompt.trim(), t2iNeeds.trim() ? `额外需求：\n${t2iNeeds.trim()}` : ""].filter(Boolean).join("\n\n");
        fd.set("mode", "t2i");
        fd.set("category", "文生图");
        fd.set("seedreamModel", seedreamModelT2I);
        fd.set("t2iPrompt", finalPrompt);
        fd.set("aspectRatio", aspectT2I);
        t2iImages.slice(0, 5).forEach((f) => fd.append("t2iImages", f));
      }

      const r = await fetch("/api/jobs", { method: "POST", body: fd, headers: { "x-invite-code": inviteCode } });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "创建任务失败");
      setJob(j.job);

      if (resultPreviewUrl) URL.revokeObjectURL(resultPreviewUrl);
      setResultPreviewUrl(null);
      setResultPreviewMime(null);
      if (j.quota) setQuotaRemaining(j.quota.remaining);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  async function downloadResult() {
    if (!inviteCode || !job?.id) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/download/${job.id}`, { headers: { "x-invite-code": inviteCode } });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || "下载失败");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ext = blob.type.startsWith("video/") ? "mp4" : blob.type.startsWith("text/") ? "txt" : "png";
      a.href = url;
      a.download = `result_${job.id}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  const sectionMeta: Record<SectionKey, { title: string; desc: string }> = {
    shoot: { title: "拍摄参考", desc: "3~5张产品图 + 模仿图 → 框选鞋子 → 换鞋生成" },
    promptVideo: { title: "提示词生成（视频）", desc: "上传参考视频 → 输出Seedance提示词（含分镜/运镜/节奏/BGM建议，时长=原视频）" },
    promptImage: { title: "提示词生成（图生提示词）", desc: "上传参考图片（多角度）→ 输出图片提示词（用于文生图/Seedream）" },
    t2v: { title: "文成视频", desc: "输入提示词 + 参考图（最多5张）→ 生成无声视频" },
    t2i: { title: "文生图", desc: "输入提示词 + 参考图（3~5张）+ 额外条件 → 生成图片" },
  };
  const isPromptHub = section === "promptVideo" || section === "promptImage";
  const heroTitle = isPromptHub ? "龟视频图片生成" : sectionMeta[section].title;
  const heroSubtitle = isPromptHub ? "通过分析图片和视频反向生成相关提示词" : sectionMeta[section].desc;
  const heroCurrent =
    section === "promptVideo"
      ? "视频生提示词"
      : section === "promptImage"
        ? "图生提示词"
        : section === "shoot"
          ? "拍摄参考"
          : section === "t2v"
            ? "文成视频"
            : "文生图";

  return (
    <div className="min-h-screen bg-tech">
      {/* toast */}
      {taskToast ? (
        <div className="fixed left-0 right-0 top-4 z-[60] flex justify-center px-5">
          <div className="pointer-events-none w-full max-w-xl rounded-2xl border border-white/12 bg-[#070914]/80 px-4 py-3 text-sm text-white/85 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-md neon-ring">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-cyan-300/90 shadow-[0_0_18px_rgba(56,189,248,0.45)]" />
                <span>{taskToast}</span>
              </div>
              <span className="text-xs text-white/55">可在右侧查看进度与预览</span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-6xl px-5 py-10">
        <header className="flex flex-col items-center text-center gap-6">
          {/* hero */}
          <div className="relative w-full overflow-hidden rounded-[44px] border border-white/10 bg-white/[0.03] px-6 py-10 md:px-10 md:py-14 neon-ring">
            {/* subtle grid */}
            <div className="pointer-events-none absolute inset-0 opacity-[0.10] [background-image:linear-gradient(to_right,rgba(255,255,255,0.22)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.22)_1px,transparent_1px)] [background-size:64px_64px]" />
            {/* glow */}
            <div className="pointer-events-none absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-orange-500/18 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-cyan-400/14 blur-3xl" />
            {/* edge highlight */}
            <div className="pointer-events-none absolute inset-0 rounded-[44px] shadow-[0_0_0_1px_rgba(56,189,248,0.08)_inset]" />

            <div className="relative">
              <div className="mx-auto mb-6 h-12 w-12 rounded-2xl border border-white/12 bg-gradient-to-br from-orange-400/25 via-amber-200/10 to-cyan-400/15 shadow-[0_0_0_1px_rgba(251,146,60,0.18)_inset]" />
              <h1 className="font-display text-[38px] leading-[1.05] md:text-6xl tracking-[0.14em] text-[#f2ead4]">
                {heroTitle}
              </h1>
              <p className="mt-4 text-sm md:text-base text-white/60">{heroSubtitle}</p>
              <p className="mt-3 text-xs text-white/40">当前：{heroCurrent}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge tone="warn">图片≤10MB/张</Badge>
            <Badge tone="warn">视频≤60MB</Badge>
            <Badge>默认无声（不含BGM音轨）</Badge>
            {inviteCode ? (
              <Badge tone="ok">
                已登录 · 邀请码 {inviteCode} · 今日额度 {quotaRemaining ?? `≤${dailyLimit}`}
              </Badge>
            ) : (
              <Badge tone="warn">需要邀请码登录</Badge>
            )}
          </div>
        </header>

        {/* top nav */}
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
          {(
            [
              { k: "shoot", t: "拍摄参考", d: "换鞋图" },
              { k: "promptVideo", t: "提示词生成（视频）", d: "视频→prompt" },
              { k: "promptImage", t: "提示词生成（图）", d: "图→prompt" },
              { k: "t2v", t: "文成视频", d: "prompt→视频" },
              { k: "t2i", t: "文生图", d: "prompt→图" },
            ] as const
          ).map((it) => (
            <button
              key={it.k}
              type="button"
              onClick={() => resetAllForSection(it.k)}
              className={[
                "rounded-2xl border px-4 py-4 text-left transition",
                it.k === "promptVideo" || it.k === "promptImage"
                  ? section === it.k
                    ? "border-orange-300/55 bg-orange-500/15 shadow-[0_0_0_1px_rgba(251,146,60,0.25)_inset]"
                    : "border-orange-400/25 bg-orange-500/8 hover:bg-orange-500/12"
                  : section === it.k
                    ? "border-cyan-300/35 bg-white/10 shadow-[0_0_0_1px_rgba(56,189,248,0.18)_inset]"
                    : "border-white/10 bg-white/4 hover:bg-white/7",
              ].join(" ")}
            >
              <div className="font-display text-lg text-white">{it.t}</div>
              <div className="mt-1 text-xs text-white/55">{it.d}</div>
            </button>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
          {/* left: inputs */}
          <Card className="neon-ring">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg text-white">输入素材</h2>
              <Badge>{sectionMeta[section].title}</Badge>
            </div>

            <div className="mt-5 space-y-5">
              {/* model picker */}
              {section === "shoot" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm text-white/85">大模型（图片生成）</label>
                    <Select value={seedreamModel} onChange={(e) => setSeedreamModel(e.target.value)}>
                      {MODEL_OPTIONS.seedream.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-white/85">比例</label>
                    <Select value={aspectShoot} onChange={(e) => setAspectShoot(e.target.value)}>
                      {ASPECT_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              ) : null}
              {section === "promptVideo" || section === "promptImage" ? (
                <div className="space-y-2">
                  <label className="text-sm text-white/85">大模型（视频理解）</label>
                  <Select value={visionModel} onChange={(e) => setVisionModel(e.target.value)}>
                    {MODEL_OPTIONS.vision.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              {section === "t2v" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm text-white/85">大模型（文生视频）</label>
                    <Select value={seedanceModelT2V} onChange={(e) => setSeedanceModelT2V(e.target.value)}>
                      {MODEL_OPTIONS.seedance.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-white/85">比例</label>
                    <Select value={aspectT2V} onChange={(e) => setAspectT2V(e.target.value)}>
                      {ASPECT_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              ) : null}
              {section === "t2i" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm text-white/85">大模型（文生图）</label>
                    <Select value={seedreamModelT2I} onChange={(e) => setSeedreamModelT2I(e.target.value)}>
                      {MODEL_OPTIONS.seedream.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-white/85">比例</label>
                    <Select value={aspectT2I} onChange={(e) => setAspectT2I(e.target.value)}>
                      {ASPECT_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              ) : null}

              {/* shoe replace inputs */}
              {section === "shoot" ? (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-white/85">产品图（3~5张，不同角度更好）</label>
                      <span className="text-xs text-white/45">最多10MB/张</span>
                    </div>
                    <Input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        setProductImages(files.slice(0, 5));
                      }}
                    />
                    <div className="text-xs text-white/55">
                      当前：{productImages.length}/5{" "}
                      {productImages.length > 0 ? `（${productImages.map((f) => f.name).join("、")}）` : ""}
                    </div>
                    {productPreviewUrls.length > 0 ? (
                      <div className="grid grid-cols-5 gap-2 pt-2">
                        {productPreviewUrls.map((u, idx) => (
                          <div
                            key={u}
                            className="overflow-hidden rounded-xl border border-white/10 bg-white/3"
                            title={productImages[idx]?.name ?? ""}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt={`产品图${idx + 1}`} className="h-24 w-full object-cover" />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm text-white/85">额外需求（生成提示）</label>
                    <Textarea placeholder="输入额外需求" value={extra} onChange={(e) => setExtra(e.target.value)} />
                    <div className="flex flex-wrap gap-2">
                      {quickPrompts.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setExtra((s) => (s ? `${s}\n${p}` : p))}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/8 hover:text-white"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-white/85">模仿图（1张）</label>
                      <span className="text-xs text-white/45">最多10MB</span>
                    </div>
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setMimicImage(f);
                        setSelections([]);
                        if (mimicPreviewUrl) URL.revokeObjectURL(mimicPreviewUrl);
                        setMimicPreviewUrl(f ? URL.createObjectURL(f) : null);
                      }}
                    />
                  </div>
                </>
              ) : null}

              {/* prompt generation */}
              {section === "promptVideo" ? (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-white/85">参考视频（1个）</label>
                      <span className="text-xs text-white/45">最多60MB</span>
                    </div>
                    <Input
                      type="file"
                      accept="video/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setPromptVideo(f);
                        if (promptVideoPreviewUrl) URL.revokeObjectURL(promptVideoPreviewUrl);
                        setPromptVideoPreviewUrl(f ? URL.createObjectURL(f) : null);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-white/85">用户BGM（可选）</label>
                    <Input
                      value={bgmInputVideo}
                      onChange={(e) => setBgmInputVideo(e.target.value)}
                      placeholder="例如：Lo-fi/电子/嘻哈、120bpm、某首歌名…"
                    />
                    <div className="text-xs text-white/55">系统会根据画面与BGM风格给出运镜、节奏、分镜建议。</div>
                  </div>
                </>
              ) : null}

              {section === "promptImage" ? (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-white/85">参考图片（最多5张）</label>
                      <span className="text-xs text-white/45">最多10MB/张</span>
                    </div>
                    <Input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []).slice(0, 5);
                        setPromptImages(files);
                      }}
                    />
                    {promptImagePreviews.length > 0 ? (
                      <div className="grid grid-cols-5 gap-2 pt-2">
                        {promptImagePreviews.map((u, idx) => (
                          <div key={u} className="overflow-hidden rounded-xl border border-white/10 bg-white/3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt={`参考图${idx + 1}`} className="h-16 w-full object-cover" />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-white/85">额外需求（可选）</label>
                      <span className="text-xs text-white/45">用于生成更贴合的图片提示词</span>
                    </div>
                    <Textarea
                      placeholder="例如：电商主图风格、纯白背景、更高级灯光、突出鞋子细节、不要文字水印…"
                      value={promptImageNeeds}
                      onChange={(e) => setPromptImageNeeds(e.target.value)}
                      className="min-h-[110px]"
                    />
                  </div>
                  <div className="text-xs text-white/55">该板块输出的是【图片提示词】，不涉及视频时长。</div>
                </>
              ) : null}

              {/* text to video */}
              {section === "t2v" ? (
                <>
                  <div className="space-y-2">
                    <label className="text-sm text-white/85">提示词</label>
                    <Textarea placeholder="输入你的Seedance提示词…" value={t2vPrompt} onChange={(e) => setT2vPrompt(e.target.value)} />
                    <div className="text-xs text-white/55">会生成无声视频（不含BGM音轨）。</div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-white/85">额外需求（可编辑）</label>
                      <span className="text-xs text-white/45">可选</span>
                    </div>
                    <Textarea
                      placeholder="例如：文案中的鞋子用我上传的图片中的鞋子；镜头多给鞋子特写；不要改背景…"
                      value={t2vNeeds}
                      onChange={(e) => setT2vNeeds(e.target.value)}
                      className="min-h-[120px]"
                    />
                    <div className="text-xs text-white/55">下面是一些可一键填入的需求案例（点击会追加到输入框）。</div>
                    <div className="flex flex-wrap gap-2">
                      {t2vNeedExamples.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setT2vNeeds((s) => (s ? `${s}\n${p}` : p))}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/8 hover:text-white"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-white/85">参考图片（最多5张）</label>
                      <span className="text-xs text-white/45">最多10MB/张</span>
                    </div>
                    <Input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []).slice(0, 5);
                        setT2vImages(files);
                      }}
                    />
                    {t2vImagePreviews.length > 0 ? (
                      <div className="grid grid-cols-5 gap-2 pt-2">
                        {t2vImagePreviews.map((u, idx) => (
                          <div key={u} className="overflow-hidden rounded-xl border border-white/10 bg-white/3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt={`参考图${idx + 1}`} className="h-16 w-full object-cover" />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-sm text-white/85">输出分辨率</label>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant={t2vPreset === "720p" ? "primary" : "ghost"}
                          onClick={() => setT2vPreset("720p")}
                          type="button"
                        >
                          720p
                        </Button>
                        <Button
                          size="sm"
                          variant={t2vPreset === "1080p" ? "primary" : "ghost"}
                          onClick={() => setT2vPreset("1080p")}
                          type="button"
                        >
                          1080p
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-white/85">输出时长</label>
                      <Select value={String(t2vDuration)} onChange={(e) => setT2vDuration(Number(e.target.value) as 5 | 7 | 15 | 30)}>
                        {[5, 7, 15, 30].map((d) => (
                          <option key={d} value={String(d)}>
                            {d}s
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </>
              ) : null}

              {/* text to image */}
              {section === "t2i" ? (
                <>
                  <div className="space-y-2">
                    <label className="text-sm text-white/85">提示词</label>
                    <Textarea placeholder="输入你的文生图提示词…" value={t2iPrompt} onChange={(e) => setT2iPrompt(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-white/85">额外需求（可编辑）</label>
                      <span className="text-xs text-white/45">可选</span>
                    </div>
                    <Textarea
                      placeholder="例如：把我的图片中的鞋子用作图片中的其中一双鞋子；背景干净；只出现一双鞋…"
                      value={t2iNeeds}
                      onChange={(e) => setT2iNeeds(e.target.value)}
                      className="min-h-[120px]"
                    />
                    <div className="text-xs text-white/55">点击下面胶囊可快速追加模板需求：</div>
                    <div className="flex flex-wrap gap-2">
                      {t2iNeedExamples.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setT2iNeeds((s) => (s ? `${s}\n${p}` : p))}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/8 hover:text-white"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-white/85">参考图片（3~5张）</label>
                      <span className="text-xs text-white/45">最多10MB/张</span>
                    </div>
                    <Input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []).slice(0, 5);
                        setT2iImages(files);
                      }}
                    />
                    <div className="text-xs text-white/55">当前：{t2iImages.length}/5</div>
                    {t2iImagePreviews.length > 0 ? (
                      <div className="grid grid-cols-5 gap-2 pt-2">
                        {t2iImagePreviews.map((u, idx) => (
                          <div key={u} className="overflow-hidden rounded-xl border border-white/10 bg-white/3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt={`参考图${idx + 1}`} className="h-16 w-full object-cover" />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              {err ? (
                <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{err}</div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-white/50">提醒：刷新/离开页面后，任务与结果将不再显示，请及时复制/下载。</div>
                <Button onClick={submit} disabled={!inviteCode || busy}>
                  {busy ? "处理中…" : "开始生成"}
                </Button>
              </div>
            </div>
          </Card>

          {/* right: section panel */}
          <div className="space-y-6">
            {section === "shoot" ? (
              <Card className="neon-ring">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-lg text-white">框选要替换的鞋子</h2>
                  <div className="text-xs text-white/55">拖拽框选（可多框）</div>
                </div>
                <div className="mt-4">
                  {!mimicPreviewUrl ? (
                    <div className="flex h-[320px] items-center justify-center rounded-2xl border border-white/10 bg-white/3 text-sm text-white/55">
                      先上传模仿图，这里会出现预览与框选层
                    </div>
                  ) : (
                    <BoxSelector src={mimicPreviewUrl} value={selections} onChange={setSelections} />
                  )}
                </div>
                <div className="mt-4 text-xs text-white/55">
                  {selections.length > 0 ? (
                    <span className="text-emerald-200/90">已选择 {selections.length} 个区域（替换 {selections.length} 双）</span>
                  ) : (
                    <span className="text-white/55">未框选：默认替换画面中的所有鞋子</span>
                  )}
                </div>
              </Card>
            ) : null}

            <Card className="neon-ring">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg text-white">任务与结果</h2>
                {job ? <StatusBadge s={job.status} /> : <Badge tone="warn">暂无任务</Badge>}
              </div>

              <div className="mt-4 space-y-4">
                {!job ? (
                  <div className="rounded-2xl border border-white/10 bg-white/3 px-4 py-6 text-sm text-white/55">
                    提交后会在这里显示进度与结果。
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/3 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm text-white/85">本次任务</div>
                      <div className="text-xs text-white/55">
                        {job.status === "failed" ? (
                          <span className="text-rose-200/90">错误：{job.error || "未知错误"}</span>
                        ) : (
                          "任务为会话级临时数据，请及时复制/下载"
                        )}
                      </div>
                    </div>

                    <div className="mt-3">
                      <ProgressBar value={job.progress ?? 0} />
                      <div className="mt-2 flex items-center justify-between text-xs text-white/55">
                        <span>进度 {Math.round(job.progress ?? 0)}%</span>
                        <span className="font-mono">{job.status}</span>
                      </div>
                    </div>

                    {section === "promptVideo" || section === "promptImage" ? (
                      job.status === "succeeded" ? (
                        <div className="mt-4 space-y-3">
                          <div className="text-xs text-white/60">
                            {section === "promptImage" ? "图片提示词（用于Seedream/文生图）" : "Seedance 提示词（含分镜/运镜/节奏/BGM建议）"}
                          </div>
                          <Textarea value={String(job.outputText ?? "")} readOnly className="min-h-[220px]" />
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={async () => {
                                try {
                                  await copyTextToClipboard(String(job.outputText ?? ""));
                                  setTaskToast("已复制提示词");
                                } catch (e: unknown) {
                                  setErr(e instanceof Error ? e.message : "复制失败");
                                }
                              }}
                            >
                              复制提示词
                            </Button>
                          </div>
                        </div>
                      ) : null
                    ) : (
                      <div className="mt-4">
                        <div className="text-xs text-white/60 mb-2">生成结果预览</div>
                        {job.status !== "succeeded" ? (
                          <div className="flex h-40 items-center justify-center rounded-2xl border border-white/10 bg-white/3 text-sm text-white/55">
                            生成完成后会在这里展示预览
                          </div>
                        ) : resultPreviewUrl ? (
                          resultPreviewMime?.startsWith("video/") ? (
                            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/3">
                              <video src={resultPreviewUrl} className="h-56 w-full object-contain bg-black/20" controls playsInline />
                            </div>
                          ) : (
                            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/3">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={resultPreviewUrl} alt="生成结果预览" className="h-56 w-full object-contain bg-black/10" />
                            </div>
                          )
                        ) : (
                          <div className="flex h-40 items-center justify-center rounded-2xl border border-white/10 bg-white/3 text-sm text-white/55">
                            正在加载预览…
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div className="text-xs text-white/55">
                        今日剩余额度：{quotaRemaining ?? "—"} / {dailyLimit}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setJob(null);
                            setErr(null);
                            if (resultPreviewUrl) URL.revokeObjectURL(resultPreviewUrl);
                            setResultPreviewUrl(null);
                            setResultPreviewMime(null);
                          }}
                          type="button"
                        >
                          清空任务
                        </Button>
                        <Button size="sm" onClick={downloadResult} disabled={busy || job.status !== "succeeded"} type="button">
                          下载结果
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>

        {/* Invite-code login overlay */}
        {!inviteCode ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative w-full max-w-md rounded-3xl border border-white/12 bg-[#070914]/80 p-6 neon-ring">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-display text-xl text-white">邀请码登录</div>
                  <div className="mt-1 text-sm text-white/55">刷新页面后需重新输入</div>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/65">SaaS · Session</span>
              </div>

              <div className="mt-5 space-y-3">
                <Input
                  placeholder="请输入邀请码（例如：DEMO2026）"
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doLogin();
                  }}
                />
                {authErr ? (
                  <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{authErr}</div>
                ) : (
                  <div className="text-xs text-white/45">
                    可在环境变量 <span className="font-mono text-white/70">INVITE_CODES</span> 中配置多个邀请码
                  </div>
                )}
                <Button className="w-full" onClick={doLogin} disabled={busy}>
                  {busy ? "验证中…" : "进入系统"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

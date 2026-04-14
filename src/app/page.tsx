"use client";

import * as React from "react";
import { BoxSelector, type NormalizedBox } from "@/components/BoxSelector";
import { VideoBoxSelector } from "@/components/VideoBoxSelector";
import { Badge, Button, Card, Input, ProgressBar, Textarea } from "@/components/ui";

type JobStatus = "queued" | "processing" | "succeeded" | "failed";
type Job = {
  id: string;
  status: JobStatus;
  progress: number;
  error?: string;
  outputMimeType?: string;
  input?: unknown;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

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

function inferIntent(text: string): "shoe" | "background" {
  const t = (text || "").toLowerCase();
  // 只要涉及背景/地面/地毯等，就走“硬替换/整图生成”，避免边缘溶解
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

export default function Home() {
  const [inviteCode, setInviteCode] = React.useState<string | null>(null);
  const [inviteInput, setInviteInput] = React.useState("");
  const [authErr, setAuthErr] = React.useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = React.useState<number>(1000);
  const [quotaRemaining, setQuotaRemaining] = React.useState<number | null>(null);

  const [mode, setMode] = React.useState<"image" | "video">("image");
  const [extra, setExtra] = React.useState("");
  const intent = React.useMemo(() => inferIntent(extra), [extra]);

  // files
  const [productImages, setProductImages] = React.useState<File[]>([]);
  const [mimicImage, setMimicImage] = React.useState<File | null>(null);
  const [mimicVideo, setMimicVideo] = React.useState<File | null>(null);
  const [videoPreset, setVideoPreset] = React.useState<"720p" | "1080p">("720p");
  const [mimicVideoDurationSec, setMimicVideoDurationSec] = React.useState<number | null>(null);
  const [videoDurationChoice, setVideoDurationChoice] = React.useState<7 | 15 | 30 | null>(null);

  // previews
  const [mimicPreviewUrl, setMimicPreviewUrl] = React.useState<string | null>(null);
  const [productPreviewUrls, setProductPreviewUrls] = React.useState<string[]>([]);
  const [resultPreviewUrl, setResultPreviewUrl] = React.useState<string | null>(null);
  const [resultPreviewMime, setResultPreviewMime] = React.useState<string | null>(null);
  const [selections, setSelections] = React.useState<NormalizedBox[]>([]);
  const [taskToast, setTaskToast] = React.useState<string | null>(null);

  // job
  const [job, setJob] = React.useState<Job | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // refresh/leave清空（满足“刷新就没有了”）
  React.useEffect(() => {
    const onBeforeUnload = () => {
      // 清理预览URL
      if (mimicPreviewUrl) URL.revokeObjectURL(mimicPreviewUrl);
      for (const u of productPreviewUrls) URL.revokeObjectURL(u);
      if (resultPreviewUrl) URL.revokeObjectURL(resultPreviewUrl);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [mimicPreviewUrl, productPreviewUrls, resultPreviewUrl]);

  // product thumbnails
  React.useEffect(() => {
    // revoke previous
    for (const u of productPreviewUrls) URL.revokeObjectURL(u);
    const next = productImages.map((f) => URL.createObjectURL(f));
    setProductPreviewUrls(next);
    // cleanup on unmount
    return () => {
      for (const u of next) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productImages]);

  // poll job
  React.useEffect(() => {
    if (!inviteCode || !job?.id) return;
    if (job.status === "succeeded" || job.status === "failed") return;
    const t = window.setInterval(async () => {
      const r = await fetch(`/api/jobs/${job.id}`, { headers: { "x-invite-code": inviteCode } });
      const j = await r.json().catch(() => null);
      if (j?.ok && j.job) setJob(j.job);
    }, 900);
    return () => window.clearInterval(t);
  }, [inviteCode, job?.id, job?.status]);

  // fetch result preview when succeeded
  React.useEffect(() => {
    if (!inviteCode || !job?.id) return;
    if (job.status !== "succeeded") return;
    if (resultPreviewUrl) return; // already fetched
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
      } catch {
        // ignore preview errors; download still available
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteCode, job?.id, job?.status, job?.outputMimeType, resultPreviewUrl]);

  // auto-hide toast
  React.useEffect(() => {
    if (!taskToast) return;
    const t = window.setTimeout(() => setTaskToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [taskToast]);

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

  function resetForMode(next: "image" | "video") {
    setMode(next);
    setErr(null);
    setJob(null);
    setSelections([]);
    if (mimicPreviewUrl) URL.revokeObjectURL(mimicPreviewUrl);
    setMimicPreviewUrl(null);
    if (resultPreviewUrl) URL.revokeObjectURL(resultPreviewUrl);
    setResultPreviewUrl(null);
    setResultPreviewMime(null);
    setMimicImage(null);
    setMimicVideo(null);
    setMimicVideoDurationSec(null);
    setVideoDurationChoice(null);
  }

  // 读取参考视频时长（用于 >30s 时显示 7/15/30 选择）
  React.useEffect(() => {
    if (mode !== "video") return;
    if (!mimicPreviewUrl) return;
    if (!mimicVideo) return;
    let cancelled = false;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = mimicPreviewUrl;
    v.onloadedmetadata = () => {
      if (cancelled) return;
      const dur = Number.isFinite(v.duration) ? v.duration : NaN;
      if (!Number.isFinite(dur)) return setMimicVideoDurationSec(null);
      setMimicVideoDurationSec(dur);
      if (dur <= 30) {
        // ≤30s：输出等长，不需要用户选
        setVideoDurationChoice(null);
      }
    };
    v.onerror = () => {
      if (cancelled) return;
      setMimicVideoDurationSec(null);
    };
    v.load();
    return () => {
      cancelled = true;
    };
  }, [mode, mimicPreviewUrl, mimicVideo]);

  async function submit() {
    if (!inviteCode) return;
    setErr(null);

    if (productImages.length !== 3) return setErr("请上传3张产品图（不同角度更好）");
    for (const f of productImages) {
      if (!fileOk(f, MAX_IMAGE_BYTES)) return setErr(`产品图超过10MB：${f.name}（${formatBytes(f.size)}）`);
    }

    // 不框选：按你的需求默认“自动检测并替换全部鞋子”

    if (mode === "image") {
      if (!mimicImage) return setErr("请上传1张模仿图");
      if (!fileOk(mimicImage, MAX_IMAGE_BYTES)) return setErr(`模仿图超过10MB：${mimicImage.name}`);
    } else {
      if (!mimicVideo) return setErr("请上传1个模仿视频");
      if (!fileOk(mimicVideo, MAX_VIDEO_BYTES)) return setErr(`模仿视频超过60MB：${mimicVideo.name}`);
      if (mimicVideoDurationSec && mimicVideoDurationSec > 30 && !videoDurationChoice) {
        return setErr("参考视频超过30秒，请选择输出时长：7秒 / 15秒 / 30秒");
      }
    }

    setBusy(true);
    try {
      setTaskToast("任务已提交，开始生成…");
      const fd = new FormData();
      fd.set("mode", mode);
      fd.set("category", "鞋子");
      fd.set("extra", extra);
      fd.set("intent", intent);
      fd.set("selection", JSON.stringify(selections));
      if (mode === "video") {
        fd.set("videoPreset", videoPreset);
        // ≤30s：输出等于原视频时长；>30s：用户选 7/15/30
        const dur =
          mimicVideoDurationSec && mimicVideoDurationSec > 0
            ? mimicVideoDurationSec > 30
              ? videoDurationChoice
              : Math.round(mimicVideoDurationSec)
            : videoDurationChoice;
        if (dur) fd.set("videoDurationSec", String(dur));
      }
      productImages.forEach((f) => fd.append("productImages", f));
      if (mode === "image" && mimicImage) fd.set("mimicImage", mimicImage);
      if (mode === "video" && mimicVideo) fd.set("mimicVideo", mimicVideo);

      const r = await fetch("/api/jobs", { method: "POST", body: fd, headers: { "x-invite-code": inviteCode } });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "创建任务失败");
      setJob(j.job);
      // 新任务：清空上一条结果预览（避免误看旧结果）
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
      const ext = blob.type.startsWith("video/") ? "mp4" : "png";
      a.href = url;
      a.download = `shoe_swap_${job.id}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-tech">
      {/* 任务开始提示 */}
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
        <header className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-cyan-400/25 via-sky-500/10 to-violet-400/25 border border-white/12 neon-ring" />
              <div>
                <h1 className="font-display text-2xl md:text-3xl text-white">
                  鞋子替换 · 商家生成工具 <span className="text-white/45 text-sm align-middle">MVP</span>
                </h1>
                <p className="text-sm text-muted">
                  3张产品图 → 1张模仿图/视频 → 框选鞋子 → 异步生成 → 立即下载（刷新页面会清空）
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge>仅支持类目：鞋子</Badge>
            <Badge tone="warn">图片≤10MB/张</Badge>
            <Badge tone="warn">视频≤60MB</Badge>
            <Badge>无声（无BGM）</Badge>
            <Badge tone="info">默认30fps（不展示给用户）</Badge>
            {inviteCode ? (
              <Badge tone="ok">
                已登录 · 邀请码 {inviteCode} · 今日额度 {quotaRemaining ?? `≤${dailyLimit}`}
              </Badge>
            ) : (
              <Badge tone="warn">需要邀请码登录</Badge>
            )}
          </div>
        </header>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
          <Card className="neon-ring">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg text-white">输入素材</h2>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={mode === "image" ? "primary" : "ghost"}
                  onClick={() => resetForMode("image")}
                >
                  图片
                </Button>
                <Button
                  size="sm"
                  variant={mode === "video" ? "primary" : "ghost"}
                  onClick={() => resetForMode("video")}
                >
                  视频
                </Button>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-white/85">产品图（3张，不同角度更好）</label>
                  <span className="text-xs text-white/45">最多10MB/张</span>
                </div>
                <Input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setProductImages(files.slice(0, 3));
                  }}
                />
                <div className="text-xs text-white/55">
                  当前：{productImages.length}/3{" "}
                  {productImages.length > 0 ? `（${productImages.map((f) => f.name).join("、")}）` : ""}
                </div>
                {productPreviewUrls.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2 pt-2">
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

              {/* 额外需求：按你的要求，视频上传前就能填写（图片同样支持） */}
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

              {mode === "image" ? (
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
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-white/85">模仿视频（1个）</label>
                    <span className="text-xs text-white/45">
                      最多60MB；{">"}30秒可选7/15/30输出；默认无声
                    </span>
                  </div>
                  <Input
                    type="file"
                    accept="video/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setMimicVideo(f);
                      setSelections([]);
                      setMimicVideoDurationSec(null);
                      setVideoDurationChoice(null);
                      if (mimicPreviewUrl) URL.revokeObjectURL(mimicPreviewUrl);
                      setMimicPreviewUrl(f ? URL.createObjectURL(f) : null);
                    }}
                  />

                  {mimicVideo ? (
                    <div className="text-xs text-white/55">
                      {mimicVideoDurationSec ? (
                        <span>检测到参考视频时长：{mimicVideoDurationSec.toFixed(1)} 秒</span>
                      ) : (
                        <span>正在读取参考视频时长…</span>
                      )}
                    </div>
                  ) : null}

                  {mimicVideoDurationSec && mimicVideoDurationSec > 30 ? (
                    <div className="pt-2">
                      <div className="mb-2 text-xs text-white/55">参考视频超过30秒，请选择输出时长</div>
                      <div className="flex items-center gap-2">
                        {[7, 15, 30].map((d) => (
                          <Button
                            key={d}
                            type="button"
                            size="sm"
                            variant={videoDurationChoice === d ? "primary" : "ghost"}
                            onClick={() => setVideoDurationChoice(d as 7 | 15 | 30)}
                          >
                            {d}s
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs text-white/55">输出分辨率</span>
                    <Button
                      size="sm"
                      variant={videoPreset === "720p" ? "primary" : "ghost"}
                      onClick={() => setVideoPreset("720p")}
                      type="button"
                    >
                      720p
                    </Button>
                    <Button
                      size="sm"
                      variant={videoPreset === "1080p" ? "primary" : "ghost"}
                      onClick={() => setVideoPreset("1080p")}
                      type="button"
                    >
                      1080p
                    </Button>
                  </div>
                </div>
              )}

              {err ? (
                <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {err}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-white/50">
                  提醒：刷新页面/离开页面后，任务与结果将不再显示，请及时下载。
                </div>
                <Button onClick={submit} disabled={!inviteCode || busy}>
                  {busy ? "处理中…" : "开始生成"}
                </Button>
              </div>
            </div>
          </Card>

          <div className="space-y-6">
            <Card className="neon-ring">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg text-white">框选要替换的鞋子</h2>
                <div className="text-xs text-white/55">方式：拖拽框选（MVP）</div>
              </div>
              <div className="mt-4">
                {!mimicPreviewUrl ? (
                  <div className="flex h-[320px] items-center justify-center rounded-2xl border border-white/10 bg-white/3 text-sm text-white/55">
                    先上传模仿{mode === "image" ? "图" : "视频"}，这里会出现预览与框选层
                  </div>
                ) : mode === "image" ? (
                  <BoxSelector src={mimicPreviewUrl} value={selections} onChange={setSelections} />
                ) : (
                  <VideoBoxSelector src={mimicPreviewUrl} value={selections} onChange={setSelections} />
                )}
              </div>
              <div className="mt-4 text-xs text-white/55">
                {selections.length > 0 ? (
                  <span className="text-emerald-200/90">已选择 {selections.length} 个区域（将替换 {selections.length} 双）</span>
                ) : (
                  <span className="text-white/55">未框选：将自动检测图片中的所有鞋子并替换</span>
                )}
              </div>
            </Card>

            <Card className="neon-ring">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg text-white">任务与下载</h2>
                {job ? <StatusBadge s={job.status} /> : <Badge tone="warn">暂无任务</Badge>}
              </div>

              <div className="mt-4 space-y-4">
                {!job ? (
                  <div className="rounded-2xl border border-white/10 bg-white/3 px-4 py-6 text-sm text-white/55">
                    提交后会在这里显示排队/进度/下载按钮。
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/3 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm text-white/85">本次任务</div>
                      <div className="text-xs text-white/55">
                        {job.status === "failed" ? (
                          <span className="text-rose-200/90">错误：{job.error || "未知错误"}</span>
                        ) : (
                          "任务为会话级临时数据，请及时下载"
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
                        <Button
                          size="sm"
                          onClick={downloadResult}
                          disabled={busy || job.status !== "succeeded"}
                          type="button"
                        >
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

        {/* Invite-code login overlay (session only) */}
        {!inviteCode ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative w-full max-w-md rounded-3xl border border-white/12 bg-[#070914]/80 p-6 neon-ring">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-display text-xl text-white">邀请码登录</div>
                  <div className="mt-1 text-sm text-white/55">仅用于灰度测试与控量（刷新页面后需重新输入）</div>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/65">
                  SaaS · Session
                </span>
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
                  <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                    {authErr}
                  </div>
                ) : (
                  <div className="text-xs text-white/45">
                    默认示例邀请码：<span className="font-mono text-white/70">DEMO2026</span>（可在环境变量 INVITE_CODES
                    中配置多个）
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

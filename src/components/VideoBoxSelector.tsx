"use client";

import * as React from "react";
import { cn } from "./ui";
import type { NormalizedBox } from "./BoxSelector";

type Props = {
  src: string;
  className?: string;
  value: NormalizedBox[];
  onChange: (boxes: NormalizedBox[]) => void;
};

function normBox(a: { x: number; y: number; w: number; h: number }) {
  const x = Math.min(a.x, a.x + a.w);
  const y = Math.min(a.y, a.y + a.h);
  const w = Math.abs(a.w);
  const h = Math.abs(a.h);
  return { x, y, w, h };
}

export function VideoBoxSelector({ src, className, value, onChange }: Props) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const boxesRef = React.useRef<NormalizedBox[]>(value);
  const dragRef = React.useRef<{
    active: boolean;
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  }>({ active: false, startX: 0, startY: 0, curX: 0, curY: 0 });

  React.useEffect(() => {
    boxesRef.current = value;
  }, [value]);

  const draw = React.useCallback(() => {
    const c = canvasRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const rect = wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;

    ctx.clearRect(0, 0, w, h);

    for (const nb of boxesRef.current) {
      const px = nb.x * w;
      const py = nb.y * h;
      const pw = nb.w * w;
      const ph = nb.h * h;
      if (pw < 3 || ph < 3) continue;
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(56,189,248,0.55)";
      ctx.shadowColor = "rgba(56,189,248,0.18)";
      ctx.shadowBlur = 12;
      ctx.strokeRect(px, py, pw, ph);
      ctx.restore();
    }

    const d = dragRef.current;
    if (!d.active && d.startX === d.curX && d.startY === d.curY) return;
    const b = normBox({ x: d.startX, y: d.startY, w: d.curX - d.startX, h: d.curY - d.startY });
    if (b.w < 3 || b.h < 3) return;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(56,189,248,0.95)";
    ctx.shadowColor = "rgba(56,189,248,0.35)";
    ctx.shadowBlur = 14;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }, []);

  React.useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  const toNormalized = React.useCallback((): NormalizedBox | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const d = dragRef.current;
    const b = normBox({ x: d.startX, y: d.startY, w: d.curX - d.startX, h: d.curY - d.startY });
    if (b.w < 10 || b.h < 10) return null;
    return { x: b.x / rect.width, y: b.y / rect.height, w: b.w / rect.width, h: b.h / rect.height };
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    dragRef.current = { active: true, startX: x, startY: y, curX: x, curY: y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    draw();
  }
  function onPointerMove(e: React.PointerEvent) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (!dragRef.current.active) return;
    const r = wrap.getBoundingClientRect();
    dragRef.current.curX = Math.max(0, Math.min(r.width, e.clientX - r.left));
    dragRef.current.curY = Math.max(0, Math.min(r.height, e.clientY - r.top));
    draw();
  }
  function onPointerUp() {
    dragRef.current.active = false;
    draw();
    const b = toNormalized();
    if (!b) return;
    onChange([...(boxesRef.current ?? []), b]);
  }

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-white/10 bg-white/3", className)}>
      <div ref={wrapRef} className="relative aspect-video w-full select-none">
        <video
          src={src}
          className="h-full w-full object-contain"
          controls
          playsInline
          onLoadedData={() => draw()}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-white/55">
        <span>建议先暂停到鞋子清晰的一帧，再拖拽框选（可多次框选，替换多双）</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="text-white/70 hover:text-white underline decoration-white/25 underline-offset-4"
            onClick={() => onChange(value.slice(0, -1))}
          >
            撤销上一个
          </button>
          <button
            type="button"
            className="text-white/70 hover:text-white underline decoration-white/25 underline-offset-4"
            onClick={() => {
              dragRef.current = { active: false, startX: 0, startY: 0, curX: 0, curY: 0 };
              draw();
              onChange([]);
            }}
          >
            清除全部
          </button>
        </div>
      </div>
    </div>
  );
}

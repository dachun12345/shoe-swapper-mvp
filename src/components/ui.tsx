"use client";

import * as React from "react";

export function cn(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  const base =
    "inline-flex items-center justify-center rounded-xl border px-4 font-medium transition will-change-transform active:translate-y-[1px] disabled:opacity-50 disabled:pointer-events-none";
  const v =
    variant === "primary"
      ? "border-white/15 bg-white/10 hover:bg-white/14 text-white shadow-[0_0_0_1px_rgba(56,189,248,0.12)_inset]"
      : variant === "danger"
        ? "border-rose-400/25 bg-rose-500/10 hover:bg-rose-500/16 text-rose-100"
        : "border-white/10 bg-transparent hover:bg-white/6 text-white/90";
  const s = size === "sm" ? "h-9 text-sm" : "h-11 text-sm";
  return <button type={type} className={cn(base, v, s, className)} {...props} />;
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-xl border border-white/12 bg-white/5 px-4 text-sm text-white placeholder:text-white/35 outline-none",
        "focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-300/10",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-[108px] w-full resize-y rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none",
        "focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-300/10",
        className
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass rounded-2xl p-5", className)} {...props} />;
}

export function Badge({
  className,
  tone = "info",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "info" | "ok" | "warn" }) {
  const t =
    tone === "ok"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      : tone === "warn"
        ? "border-amber-400/20 bg-amber-400/10 text-amber-100"
        : "border-cyan-400/20 bg-cyan-400/10 text-cyan-50";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
        t,
        className
      )}
      {...props}
    />
  );
}

export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full rounded-full bg-white/8 overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan-300/90 via-sky-400/90 to-violet-400/90 shadow-[0_0_18px_rgba(56,189,248,0.22)]"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

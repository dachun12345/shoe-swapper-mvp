import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "鞋子替换 · 商家生成工具",
  description:
    "商家上传3张产品图 + 1张模仿图/视频，框选鞋子目标，一键生成可下载的新图/新视频（MVP示例）。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许通过非 localhost 访问开发资源（用于预览/局域网/容器环境）
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.64.92", "192.168.64.27"],
};

export default nextConfig;

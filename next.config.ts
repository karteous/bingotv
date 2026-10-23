import type { NextConfig } from "next";

// Vercel 平台使用默认 serverless 输出（不生成 .next/standalone），
// Docker 部署通过 DOCKER_OUTPUT=1 环境变量启用 standalone，保证 .next/standalone 产物可被 Dockerfile COPY。
const isDockerBuild = process.env.DOCKER_OUTPUT === "1";

const nextConfig: NextConfig = {
  ...(isDockerBuild ? { output: "standalone" as const } : {}),

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
    unoptimized: true,
  },
};

export default nextConfig;

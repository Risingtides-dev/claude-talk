/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  allowedDevOrigins: ["risings-mac-mini-1.tail168656.ts.net"],
};

export default nextConfig;

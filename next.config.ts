import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: projectRoot,
  },
  serverExternalPackages: [
    "remotion",
    "@remotion/renderer",
    "@remotion/bundler",
    "@remotion/compositor-linux-x64-gnu",
    "@remotion/compositor-linux-x64-musl",
    "@remotion/compositor-linux-arm64-gnu",
    "@remotion/compositor-linux-arm64-musl",
    "@remotion/compositor-win32-x64-msvc",
    "@remotion/compositor-darwin-x64",
    "@remotion/compositor-darwin-arm64",
    "esbuild",
    "@esbuild/linux-x64",
    "@esbuild/linux-arm64",
    "@esbuild/darwin-x64",
    "@esbuild/darwin-arm64",
    "@esbuild/win32-x64",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "600mb",
    },
  },
};

export default nextConfig;

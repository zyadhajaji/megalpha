import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fix Turbopack workspace-root detection (suppresses the lockfile warning)
  turbopack: {
    root: process.cwd(),
  },
  // Remove the "N 1 Issue" dev badge from the UI
  devIndicators: false,
};

export default nextConfig;

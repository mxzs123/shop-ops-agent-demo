import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The floating dev badge sits on top of the sidebar footer.
  devIndicators: false,
  images: { unoptimized: true },
};

export default nextConfig;

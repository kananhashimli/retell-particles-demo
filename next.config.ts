import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // let phones and other devices on the local network open the dev server (e.g. http://192.168.1.x:3000)
  allowedDevOrigins: ["192.168.*.*"],
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

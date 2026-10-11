import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Railway runs `.next/standalone/server.js`, a minimal server with only the traced dependencies.
  output: "standalone",
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

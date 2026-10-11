import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Railway runs `.next/standalone/server.js`, a minimal server with only the traced dependencies.
  output: "standalone",
  // Cache Components stays off: with it on, Next.js prerenders any GET route handler that reads
  // nothing from the request, freezing responses like `GET /api/imports/latest` at build time (K15).
  // The UI fetches its data from `/api` in the browser (PRD D15), so it gains nothing from it.
  // `partialPrefetching` requires Cache Components, so it is off too.
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

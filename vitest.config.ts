import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolve the `@/` alias from tsconfig.json, the same way Next.js does.
    tsconfigPaths: true,
  },
  test: {
    globalSetup: ["tests/global-setup.ts"],
  },
});

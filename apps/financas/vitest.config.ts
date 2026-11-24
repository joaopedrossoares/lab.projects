import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@financas/shared/crypto": path.resolve(__dirname, "shared/src/crypto/vault.ts"),
      "@financas/shared": path.resolve(__dirname, "shared/src/index.ts"),
    },
  },
  test: {
    globals: true,
    include: [
      "shared/src/**/*.test.ts",
      "edge/src/**/*.test.ts",
      "backend/src/**/*.test.ts",
      "web/src/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./web/src/test/setup.ts"],
  },
});

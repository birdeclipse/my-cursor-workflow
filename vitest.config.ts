import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["prototypes/cursor-sdk-sram-workflow/test/**/*.test.ts"],
  },
});

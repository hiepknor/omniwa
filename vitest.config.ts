import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/**/*.spec.ts", "packages/**/*.spec.ts", "tooling/**/*.spec.ts"],
    passWithNoTests: true,
  },
});

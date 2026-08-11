import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
  staged: {
    "*": "vp fmt",
  },
  fmt: {
    ignorePatterns: ["dist", "dist-electron", "node_modules", "pnpm-lock.yaml", "*.tsbuildinfo"],
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: ["dist", "dist-electron", "node_modules", "pnpm-lock.yaml", "*.tsbuildinfo"],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "typescript/no-floating-promises": "off",
    },
    options: {
      typeAware: false,
      typeCheck: false,
    },
  },
});

import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      hookTimeout: 30_000,
      maxWorkers: 4,
      testTimeout: 30_000,
    },
  }),
);

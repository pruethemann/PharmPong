import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

const testDbUrl =
  process.env.DATABASE_URL_TEST ?? "postgresql://pharmapong:pharmapong@localhost:54329/pharmapong_test";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "server-only": new URL("./tests/server-only-stub.ts", import.meta.url).pathname },
  },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.int.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 60000,
          env: { DATABASE_URL: testDbUrl, NODE_ENV: "test", STORAGE_DRIVER: "memory" },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/server/domain/**/*.ts"],
      exclude: ["**/*.test.ts"],
    },
  },
});

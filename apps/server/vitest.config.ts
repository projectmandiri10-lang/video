import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_ROOT_DIR = path.join(CURRENT_DIR, ".test-runtime");

export default defineConfig({
  test: {
    environment: "node",
    env: {
      APP_ROOT_DIR: TEST_ROOT_DIR
    },
    include: ["test/**/*.test.ts"],
    sequence: {
      concurrent: false
    }
  }
});

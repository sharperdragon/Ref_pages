const { defineConfig, devices } = require("@playwright/test");

// ================================================================
// Configurable values (change here)
// ================================================================
const SERVER_PORT = 4173;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${SERVER_PORT}`;
const WEB_SERVER_COMMAND =
  process.env.PLAYWRIGHT_WEB_SERVER_CMD || "python3 ./scripts/run_static_server.py";
const TEST_DIR = "./tests/smoke";
const TEST_TIMEOUT_MS = 30_000;
const EXPECT_TIMEOUT_MS = 5_000;
const WEB_SERVER_TIMEOUT_MS = 120_000;
const RETRIES = process.env.CI ? 2 : 0;
const WORKERS = process.env.CI ? 1 : undefined;

module.exports = defineConfig({
  testDir: TEST_DIR,
  timeout: TEST_TIMEOUT_MS,
  expect: {
    timeout: EXPECT_TIMEOUT_MS,
  },
  retries: RETRIES,
  workers: WORKERS,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  webServer: {
    command: WEB_SERVER_COMMAND,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
    timeout: WEB_SERVER_TIMEOUT_MS,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

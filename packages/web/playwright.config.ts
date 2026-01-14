import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "*.e2e.ts",
  fullyParallel: false, // Run sequentially to avoid port conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker since we use a shared dev server
  reporter: "html",
  timeout: 30000,

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        headless: false, // WebGL requires headed mode
      },
    },
  ],

  webServer: {
    command: "bun run dev",
    cwd: "../../games/hello",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});

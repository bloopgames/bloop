import { defineConfig, devices } from "@playwright/test";

const isLinux = process.platform === "linux";

const chromiumArgs = isLinux
  ? [
      "--headless=new",
      "--no-sandbox",
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--disable-vulkan-surface",
      "--enable-unsafe-webgpu",
      "--ignore-gpu-blocklist",
    ]
  : [
      "--headless=new",
      "--enable-gpu",
      "--use-gl=angle",
      "--use-angle=metal",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan,UseSkiaRenderer",
      "--ignore-gpu-blocklist",
    ];

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "*.e2e.ts",
  fullyParallel: false, // Run sequentially to avoid port conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker since we use a shared dev server
  reporter: "html",
  timeout: 30000,

  snapshotPathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{ext}",

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
        launchOptions: {
          args: chromiumArgs,
        },
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

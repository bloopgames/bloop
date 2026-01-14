import { expect, test } from "@playwright/test";
import {
  FileModifier,
  loadTape,
  saveTape,
  waitForApp,
  waitForFrames,
} from "./helpers";

const CONFIG_PATH = "games/hello/src/config.ts";

// Allow small pixel differences due to rendering variations
const SCREENSHOT_OPTIONS = { maxDiffPixelRatio: 0.02 };

// Helper to pause simulation for stable screenshots
async function pauseForScreenshot(page: import("@playwright/test").Page) {
  await page.evaluate(() => (window as any).__BLOOP_APP__.sim.pause());
}

async function unpause(page: import("@playwright/test").Page) {
  await page.evaluate(() => (window as any).__BLOOP_APP__.sim.unpause());
}

test("game loads and responds to input", async ({ page }) => {
  await page.goto("/?e2e");
  await waitForApp(page);

  // Verify initial render (pause for stable screenshot)
  await pauseForScreenshot(page);
  await expect(page).toHaveScreenshot("01-initial.png", SCREENSHOT_OPTIONS);
  await unpause(page);

  // Move mouse and verify cursor rect appears
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not found");

  await page.mouse.move(box.x + 200, box.y + 200);
  await waitForFrames(page, 3);
  await pauseForScreenshot(page);
  await expect(page).toHaveScreenshot("02-mouse-moved.png", SCREENSHOT_OPTIONS);
  await unpause(page);

  // Press 'd' to move player right
  await page.keyboard.down("d");
  await waitForFrames(page, 10);
  await page.keyboard.up("d");
  await pauseForScreenshot(page);
  await expect(page).toHaveScreenshot("03-moved-right.png", SCREENSHOT_OPTIONS);
  await unpause(page);

  // Press 'w' to move player up
  await page.keyboard.down("w");
  await waitForFrames(page, 10);
  await page.keyboard.up("w");
  await pauseForScreenshot(page);
  await expect(page).toHaveScreenshot("04-moved-up.png", SCREENSHOT_OPTIONS);
});

test("HMR preserves state and input handling", async ({ page }) => {
  const fileModifier = new FileModifier();

  try {
    await page.goto("/?e2e");
    await waitForApp(page);

    // Move player to a known position
    await page.keyboard.down("d");
    await waitForFrames(page, 10);
    await page.keyboard.up("d");
    await waitForFrames(page, 2);

    // Capture pre-HMR state
    await pauseForScreenshot(page);
    await expect(page).toHaveScreenshot("05-pre-hmr.png", SCREENSHOT_OPTIONS);
    await unpause(page);

    // Track page reloads
    let pageReloaded = false;
    page.on("load", () => {
      pageReloaded = true;
    });

    // Wait for HMR message
    const hmrPromise = page.waitForEvent("console", {
      predicate: (msg) =>
        msg.text().includes("[vite]") && msg.text().includes("hot updated"),
      timeout: 10000,
    });

    // Change scale from 2 to 5
    await fileModifier.modify(CONFIG_PATH, (content) => {
      return content.replace(
        "export const scale = 2;",
        "export const scale = 5;",
      );
    });

    await hmrPromise;
    await page.waitForTimeout(500);

    // Verify page did NOT reload
    expect(pageReloaded).toBe(false);

    // Circle should be larger but in same position
    await pauseForScreenshot(page);
    await expect(page).toHaveScreenshot(
      "06-post-hmr-larger.png",
      SCREENSHOT_OPTIONS,
    );
    await unpause(page);

    // Verify mouse input still works after HMR
    const canvas = page.locator("canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas not found");

    await page.mouse.move(box.x + 300, box.y + 300);
    await waitForFrames(page, 3);
    await pauseForScreenshot(page);
    await expect(page).toHaveScreenshot(
      "07-mouse-after-hmr.png",
      SCREENSHOT_OPTIONS,
    );
  } finally {
    await fileModifier.restoreAll();
    await page.waitForTimeout(500);
  }
});

test("tape save and replay", async ({ page }) => {
  await page.goto("/?e2e");
  await waitForApp(page);

  // Move player around to create interesting tape
  await page.keyboard.down("d");
  await waitForFrames(page, 15);
  await page.keyboard.up("d");

  await page.keyboard.down("w");
  await waitForFrames(page, 15);
  await page.keyboard.up("w");

  // Capture final position
  await pauseForScreenshot(page);
  await expect(page).toHaveScreenshot(
    "08-tape-final-position.png",
    SCREENSHOT_OPTIONS,
  );

  // Save tape via Ctrl+S and verify download
  const downloadPromise = page.waitForEvent("download", { timeout: 5000 });
  await page.keyboard.press("Control+s");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^tape-\d+\.bloop$/);

  // Save tape for replay
  const tape = await saveTape(page);

  // Load tape and seek to start (loadTape auto-pauses)
  await loadTape(page, tape);
  await page.evaluate(() => {
    const app = (window as any).__BLOOP_APP__;
    const startFrame = app.sim.time.frame;
    app.sim.seek(startFrame);
  });
  await expect(page).toHaveScreenshot("09-tape-start.png", SCREENSHOT_OPTIONS);

  // Seek to middle of tape
  await page.evaluate(() => {
    const app = (window as any).__BLOOP_APP__;
    app.sim.seek(app.sim.time.frame + 15);
  });
  await expect(page).toHaveScreenshot("10-tape-middle.png", SCREENSHOT_OPTIONS);

  // Seek to end of tape
  await page.evaluate(() => {
    const app = (window as any).__BLOOP_APP__;
    const tapeEnd = app.sim.time.frame + 30;
    app.sim.seek(tapeEnd);
  });
  await expect(page).toHaveScreenshot("11-tape-end.png", SCREENSHOT_OPTIONS);
});

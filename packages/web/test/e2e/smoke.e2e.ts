import { expect, test } from "@playwright/test";
import {
  advanceFrames,
  FileModifier,
  loadTape,
  saveTape,
  waitForApp,
  waitForFrames,
} from "./helpers";

const CONFIG_PATH = "games/hello/src/config.ts";

// Allow small pixel differences due to antialiasing (3% threshold)
const SCREENSHOT_OPTIONS = { maxDiffPixelRatio: 0.03 };

// HMR test has higher threshold since timing varies
const HMR_SCREENSHOT_OPTIONS = { maxDiffPixelRatio: 0.10 };

test("game loads and responds to input", async ({ page }) => {
  await page.goto("/?e2e");
  await waitForApp(page); // App is now paused

  // Verify initial render
  await expect(page).toHaveScreenshot("01-initial.png", SCREENSHOT_OPTIONS);

  // Move mouse and verify cursor rect appears
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not found");

  await page.mouse.move(box.x + 200, box.y + 200);
  await advanceFrames(page, 5);
  await expect(page).toHaveScreenshot("02-mouse-moved.png", SCREENSHOT_OPTIONS);

  // Press 'd' to move player right
  await page.keyboard.down("d");
  await advanceFrames(page, 10);
  await page.keyboard.up("d");
  await expect(page).toHaveScreenshot("03-moved-right.png", SCREENSHOT_OPTIONS);

  // Press 'w' to move player up
  await page.keyboard.down("w");
  await advanceFrames(page, 10);
  await page.keyboard.up("w");
  await expect(page).toHaveScreenshot("04-moved-up.png", SCREENSHOT_OPTIONS);
});

test("HMR preserves state and input handling", async ({ page }) => {
  const fileModifier = new FileModifier();

  try {
    await page.goto("/?e2e");
    await waitForApp(page); // App is now paused

    // Move player to a known position
    await page.keyboard.down("d");
    await advanceFrames(page, 10);
    await page.keyboard.up("d");

    // Capture pre-HMR state
    await advanceFrames(page, 2);
    await expect(page).toHaveScreenshot("05-pre-hmr.png", SCREENSHOT_OPTIONS);

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

    // Circle should be larger but in same position (HMR preserved state)
    // Sim is paused after HMR, just take screenshot directly
    await expect(page).toHaveScreenshot(
      "06-post-hmr-larger.png",
      HMR_SCREENSHOT_OPTIONS,
    );

    // Verify mouse input still works after HMR
    const canvas = page.locator("canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas not found");

    // Unpause, move mouse, wait for a few frames, then pause for screenshot
    await page.evaluate(() => (window as any).__BLOOP_APP__.sim.unpause());
    await page.mouse.move(box.x + 300, box.y + 300);
    await waitForFrames(page, 3);
    await page.evaluate(() => (window as any).__BLOOP_APP__.sim.pause());
    await expect(page).toHaveScreenshot(
      "07-mouse-after-hmr.png",
      HMR_SCREENSHOT_OPTIONS,
    );
  } finally {
    await fileModifier.restoreAll();
    await page.waitForTimeout(500);
  }
});

test("tape save and replay", async ({ page }) => {
  await page.goto("/?e2e");
  await waitForApp(page); // App is now paused

  // Move player around to create interesting tape
  await page.keyboard.down("d");
  await advanceFrames(page, 15);
  await page.keyboard.up("d");

  await page.keyboard.down("w");
  await advanceFrames(page, 15);
  await page.keyboard.up("w");

  // Capture final position
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

  // Load tape - it auto-pauses at tape start
  await loadTape(page, tape);
  await expect(page).toHaveScreenshot("09-tape-start.png", SCREENSHOT_OPTIONS);

  // Seek to middle of tape (15 frames in)
  await page.evaluate(() => {
    const app = (window as any).__BLOOP_APP__;
    const startFrame = app.sim.time.frame;
    app.sim.seek(startFrame + 15);
  });
  await expect(page).toHaveScreenshot("10-tape-middle.png", SCREENSHOT_OPTIONS);

  // Seek to end of tape (30 frames from start)
  await page.evaluate(() => {
    const app = (window as any).__BLOOP_APP__;
    const startFrame = app.sim.time.frame - 15; // We're at middle, go back to calculate start
    app.sim.seek(startFrame + 30);
  });
  await expect(page).toHaveScreenshot("11-tape-end.png", SCREENSHOT_OPTIONS);
});

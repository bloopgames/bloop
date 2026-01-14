import { type Page } from "@playwright/test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Wait for the bloop app to initialize, then pause immediately.
 * This ensures deterministic frame numbers for subsequent waitForFrame calls.
 */
export async function waitForApp(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    () => {
      const app = (window as any).__BLOOP_APP__;
      if (app && app.sim && app.game && app.sim.time.frame >= 0) {
        // Pause immediately to prevent frames from advancing
        app.sim.pause();
        return true;
      }
      return false;
    },
    { timeout },
  );
}

/**
 * Wait for a specific number of frames to pass
 */
export async function waitForFrames(page: Page, count: number): Promise<void> {
  const start = await page.evaluate(
    () => (window as any).__BLOOP_APP__!.sim.time.frame,
  );
  const target = start + count;

  await page.waitForFunction(
    (targetFrame) =>
      (window as any).__BLOOP_APP__!.sim.time.frame >= targetFrame,
    target,
    { timeout: 5000 },
  );
}

/**
 * Advance the sim by the specified number of frames from current position and pause.
 * This is deterministic - always advances exactly N frames.
 */
export async function advanceFrames(page: Page, count: number): Promise<void> {
  await page.evaluate((frameCount) => {
    const app = (window as any).__BLOOP_APP__;
    if (!app) throw new Error("__BLOOP_APP__ not found");

    const targetFrame = app.sim.time.frame + frameCount;

    // Set target frame - App.ts will auto-pause when reached
    (window as any).__BLOOP_TARGET_FRAME = targetFrame;

    // Unpause if paused so we can advance to target
    if (app.sim.isPaused) {
      app.sim.unpause();
    }
  }, count);

  // Wait for sim to pause (afterFrame handler will pause at target)
  await page.waitForFunction(
    () => {
      const app = (window as any).__BLOOP_APP__;
      return app.sim.isPaused;
    },
    { timeout: 10000 },
  );
}

/**
 * Save the current tape
 */
export async function saveTape(page: Page): Promise<Uint8Array> {
  return await page
    .evaluate(() => {
      const app = (window as any).__BLOOP_APP__;
      if (!app) throw new Error("__BLOOP_APP__ not found");
      const tape = app.sim.saveTape();
      return Array.from(tape) as number[];
    })
    .then((arr) => new Uint8Array(arr));
}

/**
 * Load a tape into the app
 */
export async function loadTape(page: Page, tape: Uint8Array): Promise<void> {
  const tapeArray = Array.from(tape);
  await page.evaluate((tapeData) => {
    const app = (window as any).__BLOOP_APP__;
    if (!app) throw new Error("__BLOOP_APP__ not found");
    const tape = new Uint8Array(tapeData);
    app.loadTape(tape);
  }, tapeArray);
}

/**
 * File modification helper that auto-restores files after test
 */
export class FileModifier {
  private originalContents = new Map<string, string>();

  async modify(
    filePath: string,
    modifier: (content: string) => string,
  ): Promise<void> {
    const absolutePath = path.resolve(__dirname, "../../../../", filePath);

    if (!this.originalContents.has(absolutePath)) {
      const content = await fs.readFile(absolutePath, "utf-8");
      this.originalContents.set(absolutePath, content);
    }

    const current = await fs.readFile(absolutePath, "utf-8");
    await fs.writeFile(absolutePath, modifier(current), "utf-8");
  }

  async restoreAll(): Promise<void> {
    for (const [filePath, content] of this.originalContents) {
      await fs.writeFile(filePath, content, "utf-8");
    }
    this.originalContents.clear();
  }
}

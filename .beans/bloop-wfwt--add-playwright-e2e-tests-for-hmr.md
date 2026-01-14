---
# bloop-wfwt
title: Add Playwright e2e tests for HMR
status: completed
type: feature
priority: normal
created_at: 2026-01-13T19:27:15Z
updated_at: 2026-01-13T23:34:48Z
---

Add Playwright end-to-end tests to verify HMR behavior in the browser.

## Background
The HMR input bug (bloop-vjvp) was fixed with unit tests, but we should also have e2e tests that verify the full browser flow.

## What's Needed

### 1. Playwright Setup
- Add `@playwright/test` to `packages/web` devDependencies
- Create `packages/web/playwright.config.ts`
- Configure to test against the hello game dev server

### 2. Test Infrastructure
- Start the hello game dev server (vite) before tests
- Tests should interact with the game in a real browser
- May need to expose game state to window for assertions (e.g., `window.__BLOOP_GAME__`)

### 3. HMR Test Scenario
The test should:
1. Start the hello game dev server (`cd games/hello && bun dev`)
2. Navigate to the game page
3. Verify inputs work:
   - Move mouse
   - Check that `bag.mouse.x/y` updates (need to expose game state)
   - Or check for visual/console output
4. Modify `games/hello/src/config.ts` to trigger HMR
5. Wait for HMR to complete
6. Verify inputs still work after HMR

### 4. Key Files to Reference
- `games/hello/vite.config.ts` - Dev server config with `bloopLocalDevPlugin()`
- `games/hello/src/main.ts` - HMR setup with `import.meta.hot?.accept`
- `games/hello/src/game.ts` - Console logs mouse position
- `packages/web/src/App.ts:457-482` - `acceptHmr` implementation

### 5. CI Integration
- Add playwright tests to `.github/workflows/ci.yml`
- May need to install browser binaries in CI

## Implementation Notes
- Playwright can intercept console.log to verify mouse position updates
- File modification can be done with fs.writeFile in the test
- Use `page.waitForEvent('console')` to detect HMR completion
- Consider using Playwright's trace viewer for debugging flaky tests
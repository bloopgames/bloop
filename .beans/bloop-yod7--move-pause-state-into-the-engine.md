---
# bloop-yod7
title: Move pause state into the engine
status: scrapped
type: task
priority: normal
created_at: 2026-01-15T18:51:07Z
updated_at: 2026-01-17T15:26:38Z
blocking:
    - bloop-7pvq
---

## Summary

Currently the pause state (`isPaused`, `pause()`, `unpause()`) lives entirely in TypeScript (`packages/bloop/src/sim.ts:100`). This should be moved into the Zig engine for consistency with other sim state and to enable future features like pause levels.

## Current Implementation

- `#isPaused: boolean = false;` private field in Sim class
- `pause()` and `unpause()` methods set this boolean
- `step()` checks `this.#isPaused` and early-returns if true

## Proposed Changes

1. Add pause state to the engine's time context or a new pause context
2. Expose WASM functions: `pause()`, `unpause()`, `is_paused()`
3. Update TypeScript Sim class to delegate to WASM
4. Ensure pause state is included in snapshots/restore

## Related

- Blocking for: pause levels feature (system, editor, custom pause layers)
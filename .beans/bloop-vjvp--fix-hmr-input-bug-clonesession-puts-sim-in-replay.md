---
# bloop-vjvp
title: Fix HMR input bug - cloneSession puts sim in replay mode
status: completed
type: bug
priority: normal
created_at: 2026-01-13T19:23:12Z
updated_at: 2026-01-13T20:26:10Z
---

## Problem
After HMR, inputs stop working because `cloneSession` puts the new sim in replay mode via `loadTape()`.

## Root Cause
1. `acceptHmr()` calls `cloneSession(oldSim)`
2. `cloneSession()` calls `loadTape()` which sets `is_replaying = true`
3. Sim stays in replay mode even though there are no more tape events
4. `shouldEmitInputs()` returns false, all inputs suppressed

## Fix
Made the engine automatically exit replay mode when advancing past the tape end.

**In `advance()` (root.zig:288-295):**
```zig
if (self.vcr.is_replaying and self.vcr.hasTape()) {
    const tape_end_frame = self.vcr.tape.?.frame_count();
    if (self.sim.time.frame >= tape_end_frame) {
        self.vcr.exitReplayMode();
    }
}
```

**Why this works:**
- `shouldEmitInputs()` checks `!isReplaying`, not `isRecording`
- Once we exit replay mode, inputs work
- No changes needed to `sim.ts` or any TypeScript code

## Checklist
- [x] Add integration test in packages/bloop/test/sim.test.ts
- [x] Add auto-exit replay logic in advance() (root.zig)
- [x] Verify all tests pass
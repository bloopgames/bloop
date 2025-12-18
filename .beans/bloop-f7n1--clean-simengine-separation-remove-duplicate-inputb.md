---
# bloop-f7n1
title: Clean Sim/Engine separation - remove duplicate InputBuffer
status: completed
type: task
priority: normal
created_at: 2025-12-18T17:48:16Z
updated_at: 2025-12-18T18:03:04Z
---

Completed refactor to cleanly separate Sim and Engine:

## Changes
1. **Sim.init() accepts InputBuffer pointer** - No longer allocates its own, caller owns lifecycle
2. **Removed tickWithDeps()** - Replaced with simplified tick(is_resimulating) that reads match_frame and peer_count from net_ctx
3. **Engine syncs net_ctx before tick()** - beforeTickListener calculates target match_frame and syncs all context values
4. **Non-session peer_count** - Now uses input_buffer.peer_count for local multiplayer support
5. **Removed emit methods from Sim** - Event emission is Engine's responsibility; tests use TestSimContext helpers or Engine emit methods

## Files modified
- packages/engine/src/sim.zig - init signature, removed tickWithDeps & emit methods, added TestSimContext helper
- packages/engine/src/root.zig - pass input_buffer to Sim.init, updated syncNetCtx, replaced tickWithDeps calls, added emit tests
- packages/engine/src/wasm.zig - Fixed pre-existing shadowing issue
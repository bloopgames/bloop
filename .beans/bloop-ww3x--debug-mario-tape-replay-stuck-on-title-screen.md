---
# bloop-ww3x
title: Debug Mario tape replay stuck on title screen
status: completed
type: bug
priority: normal
created_at: 2026-01-06T19:08:01Z
updated_at: 2026-01-06T19:40:13Z
---

## Root Cause

When `onSessionStart` callback is called in `scaffold.ts`, the `NetSessionInit` and `peer:join` events have been **emitted but not yet processed**.

Events are only processed during `step()`. So when recording starts inside the callback, the snapshot captures:
- `in_session = 0` (should be 1)
- `peer_count = 1` (should be 2)

This causes `loadTape()` to skip session initialization (root.zig:482-484), breaking replay.

## Evidence from tape inspection
```
--- NetCtx ---
  Peer Count: 1
  In Session: 0
  Session Start Frame: 0
```

## Fix Options

1. **Flush events before `onSessionStart`**: Add `app.sim.step(0)` in scaffold.ts before calling the callback
2. **Process pending events in `startRecording`**: Have the engine flush queued events before taking the snapshot
3. **Use confirmed_snapshot**: If session was already active from a previous step, the confirmed_snapshot path would work correctly
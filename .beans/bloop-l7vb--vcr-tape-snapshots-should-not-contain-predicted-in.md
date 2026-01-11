---
# bloop-l7vb
title: VCR tape snapshots should not contain predicted input buffer state
status: todo
type: task
priority: low
created_at: 2026-01-11T18:04:29Z
updated_at: 2026-01-11T18:04:29Z
---

When recording a session tape mid-match, the VCR snapshot stitches together:
- Confirmed game state (from confirmed_snapshot)
- Current input buffer (which includes unconfirmed/predicted inputs)

This creates a snapshot that mixes confirmed and predicted state. During loadTape() and seek(), the engine sets confirmed_snapshot from these VCR snapshots, which can cause subtle issues.

## Problem Details

### startRecording() mid-session (root.zig:469-509)
When `startRecording()` is called during an active session:
1. It uses `confirmed_snapshot` for the game state (correct)
2. But writes the **current** input buffer state via `input_buffer.writeSnapshot(current_match_frame, ...)`
3. The current input buffer contains inputs up to `current_match_frame`, which may be ahead of the confirmed frame

```zig
// This captures predicted inputs, not just confirmed
const current_match_frame = self.sim.time.frame - self.sim.net_ctx.session_start_frame;
const input_buffer_len = self.input_buffer.snapshotSize(current_match_frame);
// ...
self.input_buffer.writeSnapshot(current_match_frame, tape_snapshot.input_buffer_data());
```

### loadTape() (root.zig:549-590)
After restoring the tape's snapshot:
```zig
self.sim.restore(snapshot, true);  // Restores input buffer with predicted data
// ...
// TODO: why is this needed? couldn't we just use the snapshot we restored from?
self.confirmed_snapshot = self.sim.take_snapshot(self.sim.getUserDataLen()) catch null;
```
The TODO comment reveals the confusion: we create a new `confirmed_snapshot` from the just-restored state, which has predicted input buffer data mixed in.

### seek() (root.zig:920-932)
Same pattern - restores from checkpoint (which has predicted state), then creates confirmed_snapshot from it:
```zig
self.sim.restore(snapshot, true);
if (self.confirmed_snapshot) |old| old.deinit(self.allocator);
self.confirmed_snapshot = self.sim.take_snapshot(self.sim.getUserDataLen()) catch null;
```

### input_buffer.snapshotSize() (input_buffer.zig:155-177)
The snapshot size calculation uses `current_match_frame`, capturing events beyond confirmed:
```zig
const min_confirmed = self.calculateNextConfirmFrame(current_match_frame);
const start_frame: u32 = if (min_confirmed < 0) 0 else @intCast(min_confirmed);
// Count events from start_frame to current_match_frame (includes unconfirmed!)
```

## Why This Works Currently
The step() logic handles this because:
1. During tape replay, packets are replayed which populate the input buffer correctly
2. The stepping logic uses `calculateNextConfirmFrame()` to determine what's actually confirmed
3. The predicted data in the snapshot doesn't affect correctness, just conceptual purity

## Potential Fixes
1. **Store only confirmed inputs in tape snapshot**: Calculate `confirmed_match_frame` and only snapshot inputs up to that frame
2. **Track input_buffer_confirmed_len separately**: Add a field to Snapshot that tracks how much of the input buffer is confirmed vs predicted
3. **During loadTape/seek, clear predicted portion**: After restore, truncate input buffer to confirmed state

## Impact
- Low priority - current behavior is correct, just conceptually impure
- May cause confusion when debugging tape/rollback interactions
- Could matter if we add features that depend on confirmed_snapshot being truly confirmed

## Related Files
- `packages/engine/src/root.zig`: startRecording(), loadTape(), seek()
- `packages/engine/src/input_buffer.zig`: snapshotSize(), writeSnapshot(), readSnapshot()
- `packages/engine/src/tapes/tapes.zig`: Snapshot struct
---
# bloop-gmq4
title: Use confirmed_snapshot in tape recording instead of prediction frame snapshot
status: todo
type: feature
priority: normal
created_at: 2026-01-06T05:48:49Z
updated_at: 2026-01-06T05:50:56Z
parent: bloop-7ivl
blocking:
    - bloop-9jk8
---

## Background

When tape recording starts mid-session, we currently take a snapshot at the current prediction frame. During replay, we can't rollback to this frame because it's ahead of the confirmed frame, so we use a workaround (`applyPastInputsAtCurrentFrame`) to copy unconfirmed inputs to the current frame.

This is a design oversight from the original implementation of bloop-9jk8.

## Proposed Change

Store the `confirmed_snapshot` (which already exists in Engine for rollback) in the tape instead of taking a new snapshot at tape start. This enables proper rollback during replay.

## Current Flow (with workaround)

```
startRecording():
  snapshot = take_snapshot(current_frame)  // Prediction frame, ahead of confirmed
  
loadTape():
  restore(snapshot)
  // confirmed_snapshot is NULL - can't rollback!

sessionStep() during replay:
  if (confirmed_snapshot == null && is_replaying) {
    // WORKAROUND: Can't rollback, so copy past inputs to current frame
    applyPastInputsAtCurrentFrame(prev_confirmed, next_confirmed)
    tick()
    return
  }
```

## Proposed Flow (cleaner)

```
startRecording():
  if (session.active && confirmed_snapshot != null) {
    tape.snapshot = confirmed_snapshot
    tape.confirmed_frame = session.confirmed_frame
  } else {
    tape.snapshot = take_snapshot(current_frame)
    tape.confirmed_frame = current_frame
  }

loadTape():
  restore(tape.snapshot)
  confirmed_snapshot = tape.snapshot  // Enable normal rollback!
  session.confirmed_frame = tape.confirmed_frame
  
sessionStep() during replay:
  // Normal rollback path works - no special case needed!
```

## Benefits

1. **Remove `applyPastInputsAtCurrentFrame()`** - the workaround function in root.zig
2. **Remove special case in `sessionStep()`** - the "tape replay without confirmed_snapshot" branch
3. **Simplify input buffer snapshot** - may not need to store all unconfirmed events, just confirmed frame
4. **More faithful replay** - uses same rollback mechanics as original recording

## Files to Modify

1. **packages/engine/src/root.zig**
   - `startRecording()`: Use confirmed_snapshot if available instead of taking new snapshot
   - `loadTape()`: Set confirmed_snapshot from tape, set session.confirmed_frame
   - Remove `applyPastInputsAtCurrentFrame()` function
   - Remove special case in `sessionStep()` (lines ~321-333)

2. **packages/engine/src/tapes/vcr.zig**
   - Add `confirmed_frame: u32` to tape header/format
   - Update tape serialization/deserialization

3. **packages/engine/src/tapes/tapes.zig**
   - May be able to simplify InputBufferSnapshotHeader if we only need confirmed state

4. **packages/bloop/test/tape.test.ts**
   - Update regression test expectations if needed
   - The test should still pass but with proper rollback instead of workaround

## Relevant Code Locations

- `applyPastInputsAtCurrentFrame`: root.zig:~995-1035
- Special case in sessionStep: root.zig:~321-333
- startRecording: root.zig:~395-430
- loadTape: root.zig:~780-830

## Test Plan

1. Existing tape tests should pass
2. The regression test at tape.test.ts:598 should still produce p1Score:2
3. Verify rollback count during replay matches original recording
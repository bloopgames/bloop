---
# bloop-sygq
title: Fix Platform event slot full crash on session tape seek
status: completed
type: bug
created_at: 2026-01-06T20:13:10Z
updated_at: 2026-01-06T20:13:10Z
---

Fixed a bug where seeking in a session tape after stepping forward would crash with 'Platform event slot full' panic.

## Root Cause

During seek on a session tape, `replayTapeNetEvents()` was called twice for the same frame:
1. In `advance()` at line 270 (correct - matches live behavior)
2. In `sessionStep()` during rollback resim at lines 341/365 (bug - duplicates already-buffered data)

This caused duplicate platform events to accumulate in the same PlatformEventBuffer slot. Since each slot has a max of 8 events, it would eventually panic.

## Fix

Removed the erroneous tape replay calls from `sessionStep()` resim loops. The tape replay in `advance()` is correct and sufficient because:
- During live play, events are written to buffers ONCE when they occur
- During rollback, buffers are NOT restored (restore_input_buffer=false)
- Resim reads from existing buffer data, doesn't re-add

## Files Changed

- `packages/engine/src/root.zig` - Removed tape replay from sessionStep() resim loops
- `packages/bloop/test/tape.test.ts` - Added regression test with minimal reproduction
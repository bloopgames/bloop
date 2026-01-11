---
# bloop-l7vb
title: VCR tape snapshots should not contain predicted input buffer state
status: draft
type: task
created_at: 2026-01-11T18:04:29Z
updated_at: 2026-01-11T18:04:29Z
---

When recording a session tape mid-match, the VCR snapshot stitches together:
- Confirmed game state (from confirmed_snapshot)
- Current input buffer (which includes unconfirmed/predicted inputs)

This creates a snapshot that mixes confirmed and predicted state. During loadTape() and seek(), the engine sets confirmed_snapshot from these VCR snapshots, which can cause subtle issues.

## Context
This was identified during the step() simplification refactor. The stepping logic works correctly, but there's a conceptual impurity where 'confirmed_snapshot' after loadTape/seek may contain predicted input buffer data.

## Potential fixes
1. Store only confirmed inputs in tape snapshot
2. Track input_buffer_confirmed_len separately in snapshot
3. During loadTape/seek, only restore confirmed portion of input buffer

## Related files
- packages/engine/src/root.zig: startRecording() lines 469-509
- packages/engine/src/root.zig: loadTape() line 589 TODO comment
- packages/engine/src/root.zig: seek() snapshot handling
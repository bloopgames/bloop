---
# bloop-js9t
title: Expose isConfirmFrame and isPredictionFrame in NetContext
status: completed
type: feature
created_at: 2026-01-11T05:00:58Z
updated_at: 2026-01-11T05:00:58Z
---

Added confirmed_match_frame field to NetCtx in Zig and exposed isConfirmFrame/isPredictionFrame getters in TypeScript NetContext.

## Changes
- Added confirmed_match_frame: i32 to NetCtx struct (context.zig)
- Set confirmed_match_frame = next_confirm in sessionStep() after restore (root.zig)
- Added NET_CTX_CONFIRMED_MATCH_FRAME_OFFSET constant (offsets.ts)
- Added getters: confirmedMatchFrame, isConfirmFrame, isPredictionFrame (netContext.ts)

## Implementation Details
- isConfirmFrame returns true when matchFrame <= confirmedMatchFrame
- isPredictionFrame is simply !isConfirmFrame
- Single player (peerCount <= 1) always returns isConfirmFrame=true since there are no remote peers to wait for
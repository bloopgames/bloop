---
# bloop-lgga
title: Remove +1 offset from match_frame calculation
status: in-progress
type: task
priority: normal
created_at: 2026-01-06T21:16:43Z
updated_at: 2026-01-06T21:16:48Z
---

Simplify input timing by eliminating getTargetMatchFrame() and the +1 offset.

## Current Problem
- beforeTickListener sets match_frame = time.frame + 1
- afterTickListener sets match_frame = time.frame - session_start
- This creates confusion and requires two different calculations

## Proposed Solution
- match_frame = time.frame - session_start_frame (always, no +1)
- Inputs emitted at match_frame N go to InputBuffer[N]
- tick() reads from InputBuffer[match_frame]
- No need for beforeTick/afterTick match_frame manipulation

## Changes Required
- [ ] Remove getTargetMatchFrame() helper
- [ ] Update appendInputEvent to use current match_frame
- [ ] Update beforeTickListener to just set match_frame = time.frame - session_start
- [ ] Remove match_frame manipulation from afterTickListener  
- [ ] Update sessionStep rollback logic
- [ ] Update replayTapeInputs
- [ ] Update sim.zig test helpers
- [ ] Update test comments/expectations
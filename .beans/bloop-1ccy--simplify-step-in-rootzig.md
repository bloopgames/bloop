---
# bloop-1ccy
title: Simplify step() in root.zig
status: completed
type: task
priority: normal
created_at: 2026-01-11T18:02:40Z
updated_at: 2026-01-11T18:04:29Z
---

Remove the TODO workaround in step() function by tracking 'did_restore' explicitly instead of overloading 'confirmed_up_to' for both snapshot position and game state position.

## Root Cause
The confirmed_up_to variable is overloaded:
1. Track confirmed snapshot position
2. Track game state position

When we don't restore, game state is at current_match_frame-1, but confirmed_up_to points to the snapshot frame. This causes the TODO workaround.

## Solution
Track did_restore explicitly and use it to determine where game state is.

## Checklist
- [ ] Replace step() with simplified version
- [ ] Run engine tests
- [ ] Run integration tests
- [ ] Run full CI
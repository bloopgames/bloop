---
# bloop-7h2u
title: 'Unified Event Handling: PlatformEventBuffer'
status: completed
type: feature
priority: normal
created_at: 2026-01-05T04:51:19Z
updated_at: 2026-01-05T05:20:45Z
---

Unify input and network event handling paths by introducing PlatformEventBuffer.

## Problem
Input events and network events have separate code paths for recording, replay, and rollback. This causes the saved_peers hack in sessionStep() and inconsistent behavior.

## Solution
Introduce PlatformEventBuffer that mirrors InputBuffer but for network events (indexed by engine_frame instead of match_frame).

## Checklist
- [ ] Phase 1: Create platform_event_buffer.zig with PlatformEventSlot and PlatformEventBuffer
- [ ] Phase 2: Wire PlatformEventBuffer into Engine (field, init, deinit)
- [ ] Phase 3: Update appendNetEvent to use PlatformEventBuffer (remove pending_net_events)
- [ ] Phase 4: Update beforeTickListener to read from PlatformEventBuffer
- [ ] Phase 5: Add tape recording observer for platform events
- [ ] Phase 6: Update replayTapeNetEvents to write to PlatformEventBuffer
- [ ] Phase 7: Remove saved_peers hack in sessionStep
- [ ] Phase 8: Handle packet events (synchronous processing + buffer for observation)
- [ ] Run zig tests to verify
- [ ] Run bun tests to verify integration
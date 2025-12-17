---
# bloop-u3h8
title: Input Buffer Unification
status: completed
type: epic
priority: normal
created_at: 2025-12-16T22:55:25Z
updated_at: 2025-12-17T00:00:00Z
parent: bloop-nti4
---

Unify all input handling to use a single canonical input buffer with match_frame tagging.

## Background

Currently there are multiple separate queues that must be kept in sync:
- Unacked inputs (to send to peer)
- Rollback inputs (confirmed inputs from us and peers)
- Tape inputs (recorded local inputs with different frame mechanism)
- Event buffer (read during frame processing)

Also `append_event` (for local) and `rollback.emit_inputs` (for online) have different and untested behavior.

## Goals

- All inputs (local or remote) tagged with match_frame
- Single canonical source of truth for inputs
- Packets, tape recording, and rollback processing are views onto that source
- Local play is a special case where match_frame == frames since start

## Checklist

### Phase 1: Foundation
- [x] Create `input_buffer.zig` with `InputBuffer` and `InputSlot` types
- [x] Add frame space utilities (toMatchFrame, toAbsoluteFrame)
- [x] Add observer pattern for tape recording
- [x] Unit tests for InputBuffer (12 tests passing)

### Phase 2: Integration
- [x] Replace `RollbackState.peer_inputs` with InputBuffer reference
- [x] Convert `PeerNetState.unacked_frames` to view windows

### Phase 3: Simplify Sim
- [x] Refactor `append_event` to single write path
- [x] Remove `inject_event` - tick reads from buffer directly
- [x] Replace `is_resimulating` with `tick(is_confirmed)` parameter

### Phase 4: Tape Observer
- [x] Wire up tape observer (local inputs only, on receive)
- [x] Remove rollback.zig delegates (kept as thin wrappers - net.zig uses them)
- [x] Cleanup and final testing

## Summary

The input buffer unification is complete. Key changes:
- Created `input_buffer.zig` with canonical InputBuffer
- RollbackState now references InputBuffer (removed peer_inputs)
- `append_event` writes to InputBuffer, observer handles tape recording
- `tick(is_confirmed)` reads from InputBuffer, replaces is_resimulating flag
- Removed `inject_event` - tick reads directly from InputBuffer
- PeerNetState.unacked_frames replaced with view window pointers (~192KB memory savings)
- NetState.buildOutboundPacket reads from InputBuffer instead of local copy
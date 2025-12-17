---
# bloop-5gmf
title: Networked tape replay not working after InputBuffer refactor
status: completed
type: bug
priority: high
created_at: 2025-12-17T00:17:15Z
updated_at: 2025-12-17T18:42:04Z
parent: bloop-u3h8
---

After the InputBuffer unification refactor, networked tape replay is broken. Live gameplay works correctly for both local and networked inputs.

## Symptoms
- Local multiplayer works in live gameplay
- Networked session inputs work in live gameplay  
- Networked tape recording appears to work
- Networked tape REPLAY does not work correctly

## Likely Areas to Investigate

### 1. Tape Recording Path
- `tapeInputObserver` in `sim.zig:64-86` - only records local peer inputs
- Remote peer inputs come through packets which are recorded separately
- Check if packets are being recorded to tape during networked sessions

### 2. Tape Replay Path  
- `replay_tape_inputs()` in `sim.zig:618-642` - replays local inputs from tape
- `replay_tape_packets()` in `sim.zig:598-615` - replays packets from tape
- Both are called in `step()` when `is_replaying=true`

### 3. InputBuffer During Replay
- `restore()` wipes InputBuffer but preserves observer (fixed in this PR)
- `replay_tape_inputs` writes to InputBuffer with `match_frame = time.frame + 1`
- `replay_tape_packets` calls `net.receivePacket()` which emits to InputBuffer via rollback

### 4. Key Code Paths
- **Recording**: `append_event()` -> `input_buffer.emit()` -> observer -> `tape.append_event()`
- **Packet recording**: `net.receivePacket()` stores packet, also calls `tape.append_packet()` if recording
- **Replay local**: `replay_tape_inputs()` -> `input_buffer.emit(local_peer, ...)`
- **Replay packets**: `replay_tape_packets()` -> `net.receivePacket()` -> `rollback.emitInputs()`

### 5. Potential Issues
- Packet replay might not be emitting to InputBuffer correctly
- `net.receivePacket()` might need InputBuffer reference during replay
- Match frame calculation might differ between recording and replay
- Session state (peer_count, local_peer_id) might not be restored correctly

## Relevant Files
- `packages/engine/src/sim.zig` - main simulation, tape replay logic
- `packages/engine/src/input_buffer.zig` - canonical input storage
- `packages/engine/src/net.zig` - packet handling, now uses InputBuffer
- `packages/engine/src/rollback.zig` - delegates to InputBuffer
- `packages/engine/src/tapes.zig` - tape format, packet storage

## Test to Debug
```typescript
// packages/bloop/test/tape.test.ts
it("records and replays networked session with delayed packets", ...)
```
This test was passing after the fix but manual testing shows issues.
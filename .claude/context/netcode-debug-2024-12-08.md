# Netcode Debugging Context - December 8, 2024

## Current Status
Integration tests pass but browser testing still shows issues:
1. Remote clicks register as wrong player (peer 0's click shows as player 1 on peer 1's machine)
2. Events fire multiple times (staying in ring buffer)
3. Current seq increasing but ack stays at 0

## What Was Fixed Today

### 1. Event Struct Refactoring
Added separate `peer_id` and `device` fields to Event struct:
```zig
// packages/engine/src/events.zig
pub const LOCAL_PEER: u8 = 255;

pub const Event = extern struct {
    kind: EventType,
    device: InputSource = .None,  // Was "source", now just identifies input device
    peer_id: u8 = LOCAL_PEER,     // NEW: identifies which peer sent this event
    _padding: [1]u8 = .{0},
    payload: EventPayload,
};
```

### 2. Peer ID Routing in context.zig
Events now route based on `peer_id`, not device:
```zig
// packages/engine/src/context.zig
pub fn peerIdToPlayerIndex(peer_id: u8) u8 {
    if (peer_id == Events.LOCAL_PEER) {
        return 0;  // Local input without session → player 0
    }
    return peer_id;  // peer 0 → player 0, peer 1 → player 1
}
```

### 3. Emit functions take peer_id
```zig
// sim.zig
pub fn emit_mousedown(self: *Sim, button: Events.MouseButton, peer_id: u8) void {
    self.append_event(Event.mouseDown(button, peer_id, .LocalMouse));
}
```

```typescript
// sim.ts
emit = {
  mousedown: (button: MouseButton, peerId: number = 0): void => {
    this.wasm.emit_mousedown(mouseButtonToMouseButtonCode(button), peerId);
  },
  // ...
};
```

### 4. Local events stored in rollback state
```zig
// sim.zig:append_event
fn append_event(self: *Sim, event: Event) void {
    // ...
    if (self.net != null and self.rollback != null) {
        const match_frame = self.rollback.?.getMatchFrame(self.time.frame) + 1;

        // Record to NetState for packet sending
        self.net.?.recordLocalInputs(match_frame_u16, &[_]Event{event});

        // Also store in RollbackState for local peer replay during rollback
        self.rollback.?.emitInputs(self.net.?.local_peer_id, match_frame, &[_]Event{event});
    }
    self.inject_event(event);
}
```

### 5. Received packets set peer_id from header
```zig
// rollback.zig:receivePacket
var event = wire_event.toEvent();
event.peer_id = header.peer_id;  // Route to correct player
rollback.peer_inputs[header.peer_id][slot].add(event);
```

## Passing Integration Test
`packages/bloop/test/netcode.test.ts` verifies:
- Local events register for correct player
- Packets encode/decode correctly
- Remote events route to correct player index

## Issues Fixed (December 8, 2024)

### Issue 1: Events routing to wrong player ✓ FIXED
When peer 0 clicks, peer 1 receives it but it increments player 1's score instead of player 0's.

**Root cause:** In `sim.zig:append_event`, local events were created with `peer_id=0` (browser default) instead of the actual `local_peer_id`. When peer 1 emits an event, it should have `peer_id=1` so it routes to `players[1]`.

**Fix in `sim.zig:516-527`:**
```zig
// Tag the event with the correct local peer ID for proper player routing
var local_event = event;
local_event.peer_id = self.net.?.local_peer_id;
// ... record to NetState and RollbackState with local_event ...
self.inject_event(local_event);
```

### Issue 2: Events firing multiple times ✓ FIXED
Events fire every 30 frames (ring buffer wrap interval).

**Root cause:** Ring buffer slots didn't track which frame they were written for. When frame 882 reads from slot 12 (882 % 30), it gets stale data from frame 852 (852 % 30 = 12).

**Fix:** Added `frame` field to `InputFrame` struct to track which frame each slot belongs to:
```zig
pub const InputFrame = struct {
    events: [MAX_EVENTS_PER_FRAME]Event = undefined,
    count: u8 = 0,
    frame: u32 = 0,  // NEW: tracks which frame this slot was written for

    pub fn sliceIfFrame(self: *const InputFrame, match_frame: u32) []const Event {
        if (self.frame != match_frame) return &[_]Event{};
        return self.events[0..self.count];
    }
};
```

Updated `emitInputs` and `receivePacket` to call `setFrame()` when writing, and `getInputs` to use `sliceIfFrame()` when reading.

### Issue 4: Rollback depth growing unbounded ✓ FIXED
`confirmed_frame` couldn't advance when local player was idle.

**Root cause:** `peer_confirmed_frame[local_peer_id]` only advanced when there was actual input (via `emitInputs`). If the local player didn't click for 30+ frames, `confirmed_frame` stayed stuck and rollback depth exceeded MAX_ROLLBACK_FRAMES.

**Fix in `sim.zig:sessionStep`:**
```zig
// Always advance local peer's confirmed frame, even if there's no input
if (self.net) |n| {
    if (target_match_frame > r.peer_confirmed_frame[n.local_peer_id]) {
        r.peer_confirmed_frame[n.local_peer_id] = target_match_frame;
    }
}
```

### Issue 3: Ack stays at 0 ✓ FIXED
`remote_ack` never updates even though packets are being received.

**Root cause:** In `rollback.zig:receivePacket`, `peer.remote_ack` was never set from the incoming packet's `frame_ack`.

**Fix in `rollback.zig:249-252`:**
```zig
// Update remote_ack - what frame they've received from us
if (header.frame_ack > peer.remote_ack) {
    peer.remote_ack = header.frame_ack;
}
```

## Key Files to Investigate

1. **`packages/engine/src/rollback.zig`** - `receivePacket`, `emitInputs`, ring buffer logic
2. **`packages/engine/src/sim.zig`** - `sessionStep`, `injectInputsForFrame`, `append_event`
3. **`packages/engine/src/packets.zig`** - Wire format encoding/decoding
4. **`games/quickdraw/src/main.ts`** - How packets are sent/received, peer ID assignment
5. **`games/quickdraw/src/game.ts`** - Game logic that reads `players[N].mouse`

## Debugging Approach for Tomorrow

1. **Add logging in engine** - Log when events are added to rollback, when they're injected, what peer_id they have
2. **Check packet contents** - Verify header.peer_id and frame_ack are correct in outbound packets
3. **Trace ring buffer** - Verify events are cleared properly between frames
4. **Compare integration test vs browser** - The test passes, so what's different about the browser flow?

## Quick Commands
```bash
# Run engine tests
cd packages/engine && zig build test

# Build WASM
bun run build:wasm

# Run integration tests
bun test packages/bloop/test/netcode.test.ts

# Run quickdraw dev server
cd games/quickdraw && bun run dev
```

## Wire Format Reference
```
Packet Header (8 bytes):
[u8]  version      - Wire format version (1)
[u8]  peer_id      - Sender's peer ID
[u16] frame_ack    - Highest frame we've received from recipient
[u16] frame_seq    - Our current match frame
[u8]  event_count  - Number of events
[u8]  flags        - Reserved

Event (9 bytes):
[u16] frame        - Match frame this event occurred
[u8]  kind         - EventType enum
[u8]  device       - InputSource enum
[u8]  payload[5]   - Compact payload
```

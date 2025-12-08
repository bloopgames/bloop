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

## Remaining Browser Issues to Debug

### Issue 1: Events routing to wrong player
When peer 0 clicks, peer 1 receives it but it increments player 1's score instead of player 0's.

**Possible causes:**
- `header.peer_id` might not be set correctly in outbound packet
- The quickdraw game logic might be using wrong indices
- There might be a mismatch between how quickdraw assigns peer IDs vs how engine expects them

### Issue 2: Events firing multiple times
Events seem to stay in the ring buffer and fire repeatedly.

**Possible causes:**
- `InputFrame.clear()` not being called at right time
- Ring buffer slot collision (same slot reused without clearing)
- `injectInputsForFrame` might be injecting same events multiple times during rollback

### Issue 3: Ack stays at 0
`remote_ack` never updates even though packets are being received.

**Possible causes:**
- Outbound packet's `frame_ack` field not being set correctly
- `trimAcked` not being called
- The ack value in packet header might be stale

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

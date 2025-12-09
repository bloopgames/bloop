# Rollback Netcode Demo Plan

**Demo date**: Week of Dec 9, 2024
**Audience**: Paul Weeks (indie fighting game dev)
**Goal**: Show working rollback netcode with debug visualization, code walkthrough, ideally tape replay with per-frame rollback dissection

## Reference Material

- [Muno's Rollback Explainer](https://bymuno.com/post/rollback) - Visual reference we're recreating
- `games/quickdraw/` - Proof of concept spike with working rollback, packet encoding, debug UI
- Websocket broker server - (TODO: add path once imported)

## Configuration

- Max rollback frames: 30
- Local input delay: 3 frames

---

## Workstreams

### 1. Mario Coin Block Game (~0.5 day)
New game in `games/mario-rollback/` recreating the Muno article visual:
- Two players (Mario/Luigi sprites from Aseprite)
- Single moving block with coin
- Simple platformer physics (gravity, jump, collision)
- Rendered with Toodle
- Local two-player first (Player 1: WASD, Player 2: IJKL)

**Status**: First pass completed

### 2. Engine: Per-Player Inputs (~0.5-1 day)
Extend `packages/engine` to support multiplayer input streams:
- Add `source_id` to events (u8, 0 = local, 1-255 = remote peers)
- New context struct for per-player input state (so `players[0].keys.a.down` works)
- Events tagged with frame + peer_id at capture time
- Unit tests for input merging across peers

**Status**: Completed

### 3. Engine: Rollback Core (~1 day)
Formalize rollback logic in Zig (currently in TS in quickdraw):
- Confirmed frame tracking
- Remote input buffer (per peer, keyed by frame)
- `rollback(to_frame)` -> restore snapshot, resimulate with confirmed inputs
- `predict(from_frame, to_frame)` -> resimulate with local-only inputs
- Max rollback window of 30 frames
- Configurable local input delay (3 frames)
- Unit tests for rollback scenarios

**Status**: Completed (Dec 8)
- `RollbackState` in `packages/engine/src/rollback.zig`
- `NetState` and `PeerNetState` in `packages/engine/src/net.zig`
- Ring buffer with frame tracking to prevent stale reads
- `peer_confirmed_frame` tracking per peer
- Integration tests in `packages/bloop/test/netcode.test.ts`

### 4. Engine: Packet Format (~0.5 day)
Binary packet encode/decode in Zig (port from quickdraw's `inputs.ts`):
- `[u8 type][u32 seq][u32 ack][u32 match_frame][u8 event_count][Event...]`
- Encode/decode exports for WASM boundary
- Include unacked events for retransmission
- Unit tests

**Status**: Completed (Dec 8)
- `PacketHeader` and `WireEvent` in `packages/engine/src/packets.zig`
- Compact 9-byte wire events
- Unacked buffer with retransmission support in `PeerNetState`
- TypeScript `Net` class in `packages/bloop/src/net.ts` wraps WASM exports

### 5. Tape Format: Add Packets (~0.25 day)
Extend tape format to record network packets:
- Store received packets per frame (for replay dissection)
- Store which inputs were predicted vs confirmed at each frame
- Enables the "step through rollback" visualization

**Status**: Not started

### 6. Web: Network Transport (~0.5 day)
Port/clean up from quickdraw to `packages/web`:
- WebSocket broker connection
- WebRTC peer connection with reliable/unreliable channels
- Integrate websocket server repo
- `context.net.peers` API surface

**Status**: Completed (Dec 9)
- `packages/web/src/netcode/transport.ts` - WebRTC connection with TURN
- `packages/web/src/netcode/broker.ts` - WebSocket room management
- Deployed to fly.io with buzzer and mario games

### 7. Web: Cloudflare TURN (~0.5 day)
Fix connectivity for cross-region play:
- Add Cloudflare TURN server credentials
- Test with someone remote

**Status**: Completed (Dec 9)
- TURN credentials endpoint at `infra/turn.ts`
- Cloudflare TURN API integration with 1-hour caching
- Port 53 URLs filtered (blocked by browsers)
- ICE timeout increased to 60s

### 8. Debug UI (~0.5 day)
Reuse/port from quickdraw:
- Stats panel: current frame, confirm frame, rollback depth, ping, packet stats
- Connection health indicators (green/yellow/red/grey)
- Logs panel (reuse Logs.vue pattern)
- Integrate with mario game

**Status**: Not started

### 9. Tape Replay + Rollback Dissection (stretch, ~0.5 day)
The "maximum wow factor":
- Side-by-side replay of two networked sessions
- Step through resimulation frames
- Visual indicator of predicted vs confirmed inputs per frame
- Show the actual rollback correction visually

**Status**: Not started

---

## Priority Order

| Priority | Item | Status | Notes |
|----------|------|--------|-------|
| P0 | Mario game (local multiplayer) | ✅ Done | Foundation for demo |
| P0 | Engine: per-player inputs | ✅ Done | Required for netcode |
| P0 | Engine: rollback core | ✅ Done | The main feature |
| P0 | Engine: packet format | ✅ Done | Wire protocol |
| P1 | Web: network transport | ✅ Done | Deployed to fly.io |
| P1 | Debug UI | 🔲 Next | Show the internals |
| P2 | Cloudflare TURN | ✅ Done | Cross-region connectivity |
| P3 | Tape packets + rollback dissection | 🔲 | Maximum wow factor |

---

## Session Log

### Dec 9
- Deployed buzzer and mario games to trybloop.gg/neil/buzzer and trybloop.gg/neil/mario
- Created `bin/deploy-games.ts` build/deploy script
- Added Cloudflare TURN credentials endpoint (`infra/turn.ts`)
- Fixed WASM loading for production (import.meta.url resolution)
- Filtered port 53 TURN URLs (blocked by browsers, was causing 40s ICE timeouts)
- Fixed debug UI autoscroll in Logs.vue
- Added debug toggle button to App.vue

### Dec 8
- Fixed netcode bugs (wrong player routing, ring buffer stale events, ack not updating, rollback depth unbounded)
- Separated `NetState`/`PeerNetState` into `net.zig` for cleaner architecture
- Removed unused WASM exports (`get_confirmed_frame`, `get_peer_frame`, `get_rollback_depth`, `get_unacked_count`)
- All integration tests passing
- Updated context doc: `.claude/context/netcode-debug-2024-12-08.md`

### Dec 5 (2.5 hours)
- Created this plan
- TODO: Start mario game with local multiplayer (WASD vs IJKL)
- TODO: Import websocket broker server repo

---

## Quick Reference: Existing Code to Reuse

From `games/quickdraw/`:
- `netcode/inputs.ts` - Packet encoding/decoding (port to Zig)
- `netcode/transport.ts` - WebRTC connection management
- `netcode/broker.ts` - WebSocket room management
- `netcode/logs.ts` - Log schema
- `main.ts` - Rollback loop logic (port to Zig)
- `ui/Logs.vue` - Debug log display
- `ui/Stats.vue` - Network stats display

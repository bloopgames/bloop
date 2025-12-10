# Rollback Netcode Demo Plan

**Demo date**: Week of Dec 9, 2024
**Audience**: Paul Weeks (indie fighting game dev)
**Goal**: Show working rollback netcode with debug visualization, code walkthrough, ideally tape replay with per-frame rollback dissection

---

## Demo Script

### Core Demo
1. Open https://trybloop.gg/neil/mario
2. Show "waiting for someone to join" screen
3. Have Paul open https://trybloop.gg/neil/mario
4. Mario game starts - both players can move, collect coins
5. Toggle debug UI via button in lower right corner
6. Walk through game code / answer questions

### Stretch Goals
1. Toggle artificial lag with `?lag=350` - show game has some teleporting but doesn't desync
2. Hit "Download tape" button in debug UI
3. Download tape to local file
4. Run game in dev server (`cd games/mario && bun dev`)
5. Load tape via drag+drop onto dev server
6. Show both screens side by side with shared scrubber / frame counter
7. Make code changes that hot reload while viewing tape
8. For a single frame, dissect rollback by stepping frame-by-frame through the rollback and seeing the updated render

---

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

### 10. Mario Netcode Integration (~0.5 day)
Port netcode from buzzer game to mario:
- Add broker/transport connection (copy from buzzer main.ts)
- Wire up packet send/receive to engine
- Add "waiting for player" UI state
- Add debug UI toggle button (lower right corner)
- Test with two browser windows

**Status**: Not started (currently only buzzer has netcode)

### 11. Error Handling & Netpause (~0.25 day)
Graceful degradation when things go wrong:
- Catch engine errors and display on screen (not just console)
- Implement netpause when rollback depth > 30 frames
- Show "catching up" indicator with frame delta
- Auto-resume when caught up
- Handle page reload gracefully (clean up stale peer state)

**Status**: Not started

---

## Known Bugs / Quality Issues

| Issue | Impact | Fix |
|-------|--------|-----|
| Page reload leads to unexpected results | Demo risk | Needs investigation - likely stale peer state |
| Rollback >30 frames throws error, game stops silently | Demo blocker | Show error on screen, implement netpause |
| Mario game has no netcode | Demo blocker | Port netcode integration from buzzer |

**Netpause**: When rollback depth exceeds limit, pause game execution but continue sending/receiving packets. Show visual indicator of how many frames ahead/behind we are. Resume automatically when caught up.

---

## Priority Order (Updated for Demo Script)

### P0 - Core Demo Requirements
| Item | Status | Notes |
|------|--------|-------|
| Mario game (local multiplayer) | ✅ Done | Foundation |
| Engine: per-player inputs | ✅ Done | Required for netcode |
| Engine: rollback core | ✅ Done | The main feature |
| Engine: packet format | ✅ Done | Wire protocol |
| Web: network transport | ✅ Done | Deployed to fly.io |
| Cloudflare TURN | ✅ Done | Cross-region connectivity |
| **Mario netcode integration** | 🔲 Next | Port from buzzer |
| **Debug UI toggle** | 🔲 Next | Button in lower right |
| **Crash error display** | 🔲 | Show errors on screen |

### P1 - Stretch Goals
| Item | Status | Notes |
|------|--------|-------|
| `?lag=350` artificial lag | 🔲 | Simulate bad network |
| Netpause (rollback overflow) | 🔲 | Graceful degradation |
| Download tape button | 🔲 | Export session for replay |
| Tape drag+drop loading | 🔲 | Import in dev server |
| Side-by-side replay | 🔲 | Both screens + shared scrubber |
| HMR during tape replay | 🔲 | Hot reload while viewing |
| Rollback frame dissection | 🔲 | Step through resimulation |

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

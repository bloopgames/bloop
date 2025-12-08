# Multiplayer Input Architecture Design

**Status**: Implemented (Phase 1)
**Related**: `ROLLBACK_DEMO_PLAN.md` workstreams #2, #3, #4

---

## Goals

1. Support up to 12 players (hardcoded max)
2. Each player has independent input state (keyboard, mouse, future: gamepad)
3. Decouple input sources from player slots (multiple local devices, remote peers)
4. Enable rollback by replaying events from all sources
5. Keep TypeScript API ergonomic: `context.inputs.players[0].keys.a.held`
6. Don't paint into a corner for action mappings (WASD vs IJKL) - defer to game layer

---

## Key Concepts

### Input Source vs Player Slot

```
┌─────────────────────────────────────────────────────────────────────┐
│  INPUT SOURCES                        PLAYER SLOTS                  │
│  (where input comes from)             (which PlayerInputs to use)   │
│                                                                     │
│  ┌──────────────────┐                 ┌──────────────────┐          │
│  │ Local Keyboard   │─────────────────│ Player 0         │          │
│  │ (source: 0)      │        ┌───────▶│ PlayerInputs[0]  │          │
│  └──────────────────┘        │        └──────────────────┘          │
│                              │                                      │
│  ┌──────────────────┐        │        ┌──────────────────┐          │
│  │ Local Gamepad 0  │────────┘   ┌───▶│ Player 1         │          │
│  │ (source: 1)      │            │    │ PlayerInputs[1]  │          │
│  └──────────────────┘            │    └──────────────────┘          │
│                                  │                                  │
│  ┌──────────────────┐            │    ┌──────────────────┐          │
│  │ Local Gamepad 1  │────────────┘    │ Player 2         │          │
│  │ (source: 2)      │                 │ PlayerInputs[2]  │          │
│  └──────────────────┘                 └──────────────────┘          │
│                                                                     │
│  ┌──────────────────┐                        ...                    │
│  │ Remote Peer 0    │────────────────▶                              │
│  │ (source: 128)    │                 ┌──────────────────┐          │
│  └──────────────────┘                 │ Player 11        │          │
│                                       │ PlayerInputs[11] │          │
│  ┌──────────────────┐                 └──────────────────┘          │
│  │ Remote Peer 1    │                                               │
│  │ (source: 129)    │─────────────────▶ (mapped via table)          │
│  └──────────────────┘                                               │
└─────────────────────────────────────────────────────────────────────┘

source_to_player[256] mapping table:
  [0]   = 0    (local keyboard → player 0)
  [1]   = 0    (gamepad 0 → player 0)
  [2]   = 1    (gamepad 1 → player 1)
  [128] = 1    (remote peer 0 → player 1)
  [129] = 2    (remote peer 1 → player 2)
  [255] = unmapped/ignored
```

### InputSource Enum (Defined in Zig, Codegen'd to TypeScript)

```zig
pub const InputSource = enum(u8) {
    // Local input devices (0-127)
    LocalKeyboard = 0,
    LocalGamepad0 = 1,
    LocalGamepad1 = 2,
    LocalGamepad2 = 3,
    LocalGamepad3 = 4,
    LocalGamepad4 = 5,
    LocalGamepad5 = 6,
    LocalGamepad6 = 7,
    LocalGamepad7 = 8,
    LocalGamepad8 = 9,
    LocalGamepad9 = 10,
    LocalGamepad10 = 11,
    LocalGamepad11 = 12,
    LocalGamepad12 = 13,
    LocalGamepad13 = 14,
    LocalGamepad14 = 15,
    // 16-127 reserved for future local sources

    // Remote peers (128-254)
    RemotePeer0 = 128,
    RemotePeer1 = 129,
    RemotePeer2 = 130,
    RemotePeer3 = 131,
    RemotePeer4 = 132,
    RemotePeer5 = 133,
    RemotePeer6 = 134,
    RemotePeer7 = 135,
    RemotePeer8 = 136,
    RemotePeer9 = 137,
    RemotePeer10 = 138,
    // ... up to 254

    Unmapped = 255,

    pub fn isLocal(self: InputSource) bool {
        return @intFromEnum(self) < 128;
    }

    pub fn isRemote(self: InputSource) bool {
        const val = @intFromEnum(self);
        return val >= 128 and val < 255;
    }

    pub fn remotePeerIndex(self: InputSource) ?u8 {
        if (!self.isRemote()) return null;
        return @intFromEnum(self) - 128;
    }
};
```

### Action Mapping (Game Layer - Not in Engine)

The engine deals only with raw inputs per player slot. Action mapping (e.g., "player 1 uses WASD, player 2 uses IJKL") is handled in game code:

```typescript
// Game-level action mapping (NOT in engine)
const bindings = {
  player0: { left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], jump: ['KeyW', 'Space'] },
  player1: { left: ['KeyJ'], right: ['KeyL'], jump: ['KeyI'] },
};

// In game system:
function getAction(player: number, action: string): boolean {
  const keys = bindings[`player${player}`][action];
  return keys.some(k => context.inputs.players[player].keys[k].held);
}
```

This keeps the engine simple and lets games define their own control schemes.

---

## Data Structures (Zig)

### Event (Updated)

```zig
pub const Event = extern struct {
    kind: EventType,
    source: InputSource,     // NEW: input source enum
    _padding: [2]u8,         // explicit padding for alignment
    payload: EventPayload,
};
// Size: 12 bytes (same as before due to alignment)
```

### PlayerInputs (New)

```zig
pub const PlayerInputs = extern struct {
    key_ctx: KeyCtx,      // 256 bytes
    mouse_ctx: MouseCtx,  // 24 bytes

    pub fn process_event(self: *PlayerInputs, event: Event) void {
        switch (event.kind) {
            .KeyDown => self.key_ctx.key_states[@intFromEnum(event.payload.key)] |= 1,
            .KeyUp => self.key_ctx.key_states[@intFromEnum(event.payload.key)] &= 0xFE,
            .MouseMove => {
                self.mouse_ctx.x = event.payload.mouse_move.x;
                self.mouse_ctx.y = event.payload.mouse_move.y;
            },
            .MouseDown => self.mouse_ctx.button_states[@intFromEnum(event.payload.mouse_button)] |= 1,
            .MouseUp => self.mouse_ctx.button_states[@intFromEnum(event.payload.mouse_button)] &= 0xFE,
            .MouseWheel => {
                self.mouse_ctx.wheel_x = event.payload.delta.delta_x;
                self.mouse_ctx.wheel_y = event.payload.delta.delta_y;
            },
            else => {},
        }
    }

    pub fn age_states(self: *PlayerInputs) void {
        for (&self.key_ctx.key_states) |*state| {
            const held = state.* & 1;
            state.* = (state.* << 1) | held;
        }
        for (&self.mouse_ctx.button_states) |*state| {
            const held = state.* & 1;
            state.* = (state.* << 1) | held;
        }
        // Reset wheel deltas each frame
        self.mouse_ctx.wheel_x = 0;
        self.mouse_ctx.wheel_y = 0;
    }
};
// Size: ~280 bytes per player
```

### InputCtx (Updated)

```zig
pub const MAX_PLAYERS: u8 = 12;

pub const InputCtx = extern struct {
    /// Bitmask of active players (bit N = player N is active)
    active_players: u16,

    /// Maps source → player slot (Unmapped = ignored)
    source_to_player: [256]u8,

    /// Per-player input state
    players: [MAX_PLAYERS]PlayerInputs,

    pub fn init() InputCtx {
        var ctx: InputCtx = undefined;
        ctx.active_players = 0x0001;  // Player 0 active by default
        @memset(&ctx.source_to_player, @intFromEnum(InputSource.Unmapped));
        ctx.source_to_player[@intFromEnum(InputSource.LocalKeyboard)] = 0;  // Keyboard → player 0
        @memset(std.mem.asBytes(&ctx.players), 0);
        return ctx;
    }

    pub fn process_event(self: *InputCtx, event: Event) void {
        const player_slot = self.source_to_player[@intFromEnum(event.source)];
        if (player_slot == @intFromEnum(InputSource.Unmapped) or player_slot >= MAX_PLAYERS) return;
        if ((self.active_players & (@as(u16, 1) << @intCast(player_slot))) == 0) return;

        self.players[player_slot].process_event(event);
    }

    pub fn age_all_states(self: *InputCtx) void {
        var mask = self.active_players;
        var i: u8 = 0;
        while (mask != 0) : (i += 1) {
            if ((mask & 1) != 0) {
                self.players[i].age_states();
            }
            mask >>= 1;
        }
    }

    pub fn set_player_active(self: *InputCtx, player: u8, active: bool) void {
        if (player >= MAX_PLAYERS) return;
        if (active) {
            self.active_players |= (@as(u16, 1) << @intCast(player));
        } else {
            self.active_players &= ~(@as(u16, 1) << @intCast(player));
        }
    }

    pub fn map_source_to_player(self: *InputCtx, source: InputSource, player: u8) void {
        self.source_to_player[@intFromEnum(source)] = player;
    }
};
// Size: 2 + 256 + (12 * 280) = ~3618 bytes
```

### EventBuffer (Updated)

```zig
pub const EventBuffer = extern struct {
    count: u16,              // Increased from u8
    _padding: [2]u8,
    events: [1024]Event,     // Increased from 128
};
// Size: 4 + (1024 * 12) = ~12KB
```

---

## WASM Exports

All emit functions require `source: InputSource` parameter:

```zig
export fn emit_keydown(key: Key, source: InputSource) void;
export fn emit_keyup(key: Key, source: InputSource) void;
export fn emit_mousedown(button: MouseButton, source: InputSource) void;
export fn emit_mouseup(button: MouseButton, source: InputSource) void;
export fn emit_mousemove(x: f32, y: f32, source: InputSource) void;
export fn emit_mousewheel(dx: f32, dy: f32, source: InputSource) void;
```

### Player/Source Management

```zig
export fn set_player_active(player: u8, active: bool) void;
export fn map_source_to_player(source: InputSource, player: u8) void;
export fn get_active_players() u16;  // Returns bitmask
```

---

## TypeScript API

### InputSource (Codegen'd from Zig)

```typescript
// Generated from Zig InputSource enum
export const InputSource = {
    LocalKeyboard: 0,
    LocalGamepad0: 1,
    LocalGamepad1: 2,
    // ...
    RemotePeer0: 128,
    RemotePeer1: 129,
    // ...
    Unmapped: 255,
} as const;

export type InputSource = typeof InputSource[keyof typeof InputSource];
```

### InputContext (Updated)

```typescript
class InputContext {
    readonly players: readonly PlayerInputContext[];

    constructor(dataView: DataView, playerCount: number) {
        // Build array of PlayerInputContext for active players
    }

    // Backward compat: delegate to player 0
    get keys(): KeyboardContext { return this.players[0].keys; }
    get mouse(): MouseContext { return this.players[0].mouse; }
}

class PlayerInputContext {
    readonly keys: KeyboardContext;
    readonly mouse: MouseContext;
}
```

### Sim Emit API (Updated)

```typescript
class Sim {
    emit = {
        // Convenience methods (source = LocalKeyboard)
        keydown: (key: Key) => this.wasm.emit_keydown(key, InputSource.LocalKeyboard),
        keyup: (key: Key) => this.wasm.emit_keyup(key, InputSource.LocalKeyboard),
        mousedown: (button: MouseButton) => this.wasm.emit_mousedown(button, InputSource.LocalKeyboard),
        mouseup: (button: MouseButton) => this.wasm.emit_mouseup(button, InputSource.LocalKeyboard),
        mousemove: (x: number, y: number) => this.wasm.emit_mousemove(x, y, InputSource.LocalKeyboard),
        mousewheel: (dx: number, dy: number) => this.wasm.emit_mousewheel(dx, dy, InputSource.LocalKeyboard),

        // Full control with explicit source
        keydownFrom: (key: Key, source: InputSource) => this.wasm.emit_keydown(key, source),
        keyupFrom: (key: Key, source: InputSource) => this.wasm.emit_keyup(key, source),
        mousedownFrom: (button: MouseButton, source: InputSource) => this.wasm.emit_mousedown(button, source),
        mouseupFrom: (button: MouseButton, source: InputSource) => this.wasm.emit_mouseup(button, source),
        mousemoveFrom: (x: number, y: number, source: InputSource) => this.wasm.emit_mousemove(x, y, source),
        mousewheelFrom: (dx: number, dy: number, source: InputSource) => this.wasm.emit_mousewheel(dx, dy, source),
    };

    setPlayerActive(player: number, active: boolean): void;
    mapSourceToPlayer(source: InputSource, player: number): void;
    getActivePlayers(): number;  // bitmask
}
```

---

## Demo Configuration (Mario Rollback)

For the demo with local 2-player (WASD vs IJKL):

```typescript
// Both players use the same local keyboard (source 0)
// Action mapping handled in game code, not engine

sim.setPlayerActive(0, true);
sim.setPlayerActive(1, true);
sim.mapSourceToPlayer(InputSource.LocalKeyboard, 0);  // keyboard events → player 0

// Game code handles WASD vs IJKL:
game.system("mario-controls", {
    update({ bag, inputs }) {
        // Player 0: WASD
        const p0 = inputs.players[0].keys;
        if (p0.a.held) bag.players[0].vx = -SPEED;
        if (p0.d.held) bag.players[0].vx = SPEED;
        if (p0.w.down) bag.players[0].vy = JUMP;

        // Player 1: IJKL (still reads from player 0's input state!)
        // All keyboard input goes to player 0, game interprets different keys
        if (p0.j.held) bag.players[1].vx = -SPEED;
        if (p0.l.held) bag.players[1].vx = SPEED;
        if (p0.i.down) bag.players[1].vy = JUMP;
    }
});
```

For networked play:

```typescript
// Local player on keyboard (source 0) → player 0
// Remote peer (source 128) → player 1
sim.setPlayerActive(0, true);
sim.setPlayerActive(1, true);
sim.mapSourceToPlayer(InputSource.LocalKeyboard, 0);  // local keyboard → player 0
sim.mapSourceToPlayer(InputSource.RemotePeer0, 1);    // remote peer → player 1

// On receiving remote packet:
for (const event of packet.events) {
    sim.emit.keydownFrom(event.key, InputSource.RemotePeer0);
}
```

---

## Snapshot/Restore

The full `InputCtx` (including `active_players`, `source_to_player`, and all `PlayerInputs`) is snapshotted and restored. This ensures:

1. Rollback restores correct input state for all players
2. Source mappings are preserved across rollback
3. Active player set is preserved

---

## Implementation Phases

### Phase 1: Core Data Structures ✅
- [x] Add `InputSource` enum to `events.zig` (None=0, LocalKeyboard=1, LocalGamepad0-11, RemotePeer0-11, Unmapped=255)
- [x] Add `source: InputSource` to `Event` struct
- [x] Create `PlayerInputs` struct (extract from `InputCtx`)
- [x] Update `InputCtx` with `players[12]` array
- [x] Update `EventBuffer` to 512 events, u16 count
- [x] Update `process_event` (currently routes all to player 0 - source mapping deferred)
- [x] Update aging to iterate all players

### Phase 2: WASM Exports ✅
- [x] Update all `emit_*` to require `source: InputSource` parameter
- [ ] Add `set_player_active`, `map_source_to_player`, `get_active_players` (deferred)

### Phase 3: TypeScript Bindings ✅
- [x] Codegen `InputSource` enum from Zig
- [x] Update `InputContext` with `players` array
- [x] Create `PlayerInputContext` class
- [x] Add backward-compat getters (`inputs.keys` -> `inputs.players[0].keys`)
- [x] Add `players` to `Context` type
- [x] Update `Sim.emit` with optional `source` parameter (default: `LocalKeyboard`)

### Phase 4: Tests ✅
- [x] TypeScript type check passes
- [x] All existing bun tests pass (37 pass)
- [x] Zig tests pass (8 pass)
- [ ] Multi-player local test (deferred - needs source->player mapping)
- [ ] Source routing test (deferred)

---

## Open Questions (Deferred)

1. **Gamepad API** - What does the gamepad input struct look like? (axes, buttons, triggers)
2. **Hot-plug devices** - How to handle gamepad connect/disconnect mid-game?
3. **Input rebinding UI** - Standard way for games to expose control configuration?
4. **Analog inputs** - Joystick axes need different representation than buttons

These are all future concerns that don't block the current design.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Snapshot size growth | Low | ~3.6KB vs ~280B, still negligible |
| Event buffer memory | Low | ~12KB, acceptable |
| Complexity creep | Medium | Keep engine simple, push mapping to game layer |
| Breaking changes | Medium | Convenience methods maintain ergonomic API |

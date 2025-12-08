# Refactor: Extract Sim from Engine

**Goal**: Extract platform-agnostic simulation logic from `engine.zig` into a new `sim.zig` module that is unit testable without WASM.

**Why**: The rollback netcode work (workstream #3 in ROLLBACK_DEMO_PLAN.md) requires complex state management that needs thorough unit tests. Currently `engine.zig` mixes WASM boundary concerns with simulation logic, making it hard to test.

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      engine.zig                         │
│  - WASM exports (pub export fn ...)                     │
│  - extern declarations (console_log, __cb, etc.)        │
│  - Global Sim instance                                  │
│  - Pointer/slice conversions                            │
│  - Callback wiring                                      │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                       sim.zig                           │
│  - Sim struct with all simulation state                 │
│  - Time stepping (step, tick, seek)                     │
│  - Recording/playback (start_recording, load_tape)      │
│  - Snapshots (take_snapshot, restore)                   │
│  - Event handling (emit_*, process_events, flush)       │
│  - Platform-agnostic callbacks via function pointers    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              context.zig, events.zig, tapes.zig         │
│                    (unchanged)                          │
└─────────────────────────────────────────────────────────┘
```

---

## Sim struct definition

```zig
pub const Callbacks = struct {
    before_frame: ?*const fn (frame: u32) void = null,
    systems: ?*const fn (ctx_ptr: usize, dt: u32) void = null,
    user_serialize: ?*const fn (ptr: usize, len: u32) void = null,
    user_deserialize: ?*const fn (ptr: usize, len: u32) void = null,
};

pub const Sim = struct {
    time: *TimeCtx,
    inputs: *InputCtx,
    events: *EventBuffer,
    tape: ?Tapes.Tape = null,
    accumulator: u32 = 0,
    is_recording: bool = false,
    is_replaying: bool = false,
    callbacks: Callbacks = .{},
    allocator: std.mem.Allocator,
    ctx_ptr: usize,  // pointer to pass to callbacks (for JS interop)

    // ... methods
};
```

---

## Implementation steps

### Step 1: Create sim.zig with Sim struct and init/deinit

Create the file with:
- Imports
- Callbacks struct
- Sim struct with fields
- `pub fn init(allocator, ctx_ptr) !Sim` - allocates TimeCtx, InputCtx, EventBuffer
- `pub fn deinit(self: *Sim) void` - frees contexts and tape

**Test**: Unit test that init/deinit doesn't leak memory.

### Step 2: Move tick() and step() to Sim

Move the core simulation loop:
- `pub fn step(self: *Sim, ms: u32) u32` - accumulator-based stepping
- `pub fn tick(self: *Sim) void` - single frame advance

Internal helpers to move:
- `fn process_events(self: *Sim) void`
- `fn flush_events(self: *Sim) void`
- `fn use_tape_events(self: *Sim) void`

Update engine.zig to delegate to sim instance.

**Test**: Unit test step() advances frames correctly, tick() processes events.

### Step 3: Move event emission to Sim

Move:
- `fn append_event(self: *Sim, event: Event) void`
- `pub fn emit_event(self: *Sim, event: Event) void`
- `pub fn emit_keydown/keyup/mousedown/mouseup/mousemove/mousewheel`

Update engine.zig exports to delegate.

**Test**: Unit test that emitted events appear in event buffer and get recorded to tape.

### Step 4: Move snapshot/restore to Sim

Move:
- `pub fn take_snapshot(self: *Sim, user_data_len: u32) !*Tapes.Snapshot`
- `pub fn restore(self: *Sim, snapshot: *Tapes.Snapshot) void`

These need to call user_serialize/user_deserialize callbacks.

Update engine.zig to delegate.

**Test**: Unit test snapshot roundtrip preserves time, inputs, events.

### Step 5: Move recording/playback to Sim

Move:
- `pub fn start_recording(self: *Sim, user_data_len: u32, max_events: u32) !void`
- `pub fn stop_recording(self: *Sim) void`
- `pub fn load_tape(self: *Sim, tape_buf: []u8) !void`
- `pub fn get_tape_buffer(self: *const Sim) ?[]u8`

Update engine.zig to delegate (with ptr/len conversion for WASM).

**Test**: Unit test recording events, loading tape, replay mode flag.

### Step 6: Move seek() to Sim

Move:
- `pub fn seek(self: *Sim, frame: u32) void`

This depends on tape, restore, tick all being in Sim.

Update engine.zig to delegate.

**Test**: Unit test seek to various frames, verify correct state restored.

### Step 7: Clean up engine.zig

After all moves:
- engine.zig should only have:
  - extern declarations
  - global `var sim: ?Sim`
  - arena allocator for logging
  - WASM export functions that delegate to sim
  - alloc/free exports
  - panic handler
  - callback wrapper functions that call externs

### Step 8: Add comprehensive Sim tests

Add tests for:
- Multiple frames with events
- Recording and playback
- Seek forward and backward
- Snapshot during recording
- Edge cases (seek to frame 0, empty tape, etc.)

---

## Engine.zig export mapping (post-refactor)

```zig
// engine.zig (after refactor)

var sim: ?Sim = null;

pub export fn initialize() wasmPointer {
    // ... arena/log init ...
    sim = Sim.init(wasm_alloc, cb_ptr) catch return 0;
    sim.?.callbacks = .{
        .before_frame = wasm_before_frame,
        .systems = wasm_systems_callback,
        .user_serialize = wasm_user_serialize,
        .user_deserialize = wasm_user_deserialize,
    };
    return cb_ptr;
}

pub export fn step(ms: u32) u32 {
    return sim.?.step(ms);
}

pub export fn tick() void {
    sim.?.tick();
}

// ... etc for all other exports
```

---

## Files changed

| File | Change |
|------|--------|
| `packages/engine/src/sim.zig` | **NEW** - Core simulation logic |
| `packages/engine/src/engine.zig` | Gutted to thin WASM wrapper |
| `packages/engine/src/root.zig` | Add `pub const Sim = @import("sim.zig");` if needed |

---

## Verification

1. `cd packages/engine && zig build test` - All new unit tests pass
2. `cd packages/engine && bun run build:wasm` - WASM builds successfully
3. `bun test` - All existing integration tests pass
4. `cd games/mario-rollback && bun dev` - Game still runs correctly

---

## Future: Rollback additions to Sim

Once this refactor is complete, adding rollback to Sim becomes straightforward:

```zig
// Future additions to Sim struct
confirmed_frame: u32 = 0,
remote_input_buffers: [MAX_PEERS]InputBuffer,
snapshots: [MAX_ROLLBACK_FRAMES]*Snapshot,

// Future methods
pub fn rollback(self: *Sim, to_frame: u32) void { ... }
pub fn predict(self: *Sim, from_frame: u32, to_frame: u32) void { ... }
pub fn confirm_inputs(self: *Sim, peer: u8, frame: u32, events: []Event) void { ... }
```

These will all be unit testable without WASM.

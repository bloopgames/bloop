This is Bloop, a rewindable 2D game simulation library built with TypeScript and Zig. We are currently working towards `.claude/Q1_2025_ROADMAP.md`

## Key Features

- Writing game state and logic in TypeScript
- Rewinding any live or recorded gameplay session
- Hot reloading code changes during rewinded play sessions
- Rollback netcode (in development) for up to 12 player sessions.

## Build & Development Commands

Use Bun exclusively (not npm/yarn/pnpm/node):

```bash
# Install dependencies
bun install

# Run all checks
bun run ci

# Type checking
bun run ci:tsc

# Run ts tests
bun test

# Build engine WASM
(cd packages/engine && bun run build:wasm)

# Run engine tests
(cd packages/engine && zig build test)

# Run a single test file
bun test packages/bloop/test/bloop.test.ts

# Watch engine WASM during development
(cd packages/engine && bun dev)

# Run a specific game dev server
cd games/buzzer && bun run dev

# Deploy all games to trybloop.gg
bun run deploy-games
```

## Monorepo Structure

**Packages (publishable libraries):**

- `packages/bloop` - TypeScript game framework (`@bloopjs/bloop`) - the main API for creating games. Speed of expression is the north star. Write integration tests that cover user-facing APIs here.

- `packages/engine` - Zig core that handles time, inputs, events, snapshots, and tape recording. Performance is the north star. Write high coverage unit tests for all modules heres.

- `packages/web` - Browser runtime (`@bloopjs/web`) - handles RAF loop, DOM events, HMR, translating browser APIs into bloop calls. Write end-to-end smoke tests using Playwright.

**Games (example apps):**

- `games/hello` - Minimal example game
- `games/quickdraw` - Vue-based prototype with netcode (uses Vite, not Bun.serve)
- `games/mario` - Mario platformer with rollback netcode

## Architecture

### Core Concepts

**Bloop** - Main game class created via `Bloop.create({ bag: {...} })`. The `bag` is singleton game state that gets serialized for snapshots/rollback.

**System** - Game logic registered via `game.system("name", { update, keydown, mousedown, ... })`. Systems receive a `Context` with `bag`, `time`, and `inputs`.

**Sim** - Simulation runner that wraps the WASM engine. Handles stepping frames forward/backward, recording/replaying tapes, and snapshotting state. Note that `sim.seek(frame)` uses absolute frame numbers, not relative to tape start—if recording started at frame 3, seek to frame 3 to get the beginning of the tape.

**App** (web only) - Browser runtime that connects DOM events to the Sim and runs the RAF loop. Handles HMR via `app.acceptHmr()`.

### Data Flow

1. Browser events captured by `App` -> emit to `Sim`
2. `Sim.step()` calls WASM engine which processes inputs and fires callback
3. WASM callback invokes TypeScript systems with current `Context`
4. Systems read `context.players` for inputs and mutate `context.bag`
5. Engine snapshots bag via `serialize`/`deserialize` hooks for rewind capability

### Engine (Zig/WASM)

The engine in `packages/engine/src/*.zig` manages:

- Time context (frame, dt, elapsed time)
- Multiplayer input states (eg player[0].keys, player[0].mouse)
- Event queue
- Tape recording/playback
- Snapshot/restore

Performance is the north star, and we should have high unit test coverage here. We should prefer having one explicit way to do things instead more ergonomic apis. Exported wasm functions must be listed explicitly in build.zig

TypeScript interacts with WASM through `WasmEngine` interface. The `mount()` function instantiates WASM and wires up callbacks. Note that WASM exports return `0`/`1` for booleans, so wrap with `Boolean()` in TypeScript:

```typescript
get isRecording(): boolean {
  return Boolean(this.wasm.is_recording());
}
```

Each WASM page is 64KB. When adding new static allocations to the engine, run wasm-objdump -j Import -x zig-out/wasm/bloop.wasm to check the required initial pages and update mount.ts if needed.

WASM extern callbacks use double-underscore prefix (__systems, __before_frame,
  __user_data_len) to avoid shadowing parameter names in exported functions. These callbacks receive a context pointer as their first argument for accessing engine state.

For logging in Zig, use the `Log` module which outputs to the browser console:

```zig
const Log = @import("log.zig");
Log.log("Message with args: {d}", .{value});
```

### Context Pattern (Engine → TypeScript data)

When exposing engine data to TypeScript, follow the established DataView pattern used by `TimeContext`, `InputContext`, and `NetContext`

### Bloop - packages/bloop (TypeScript user-facing apis)

## Testing Pattern

```typescript
import { describe, expect, it } from "bun:test";
import { Bloop, mount } from "@bloopjs/bloop";

it("test name", async () => {
  const game = Bloop.create({ bag: { value: 0 } });
  game.system("test", {
    update({ bag }) {
      bag.value++;
    },
  });

  const { sim } = await mount(game);
  sim.step(16);
  expect(game.bag.value).toBe(1);
});
```

## Development Notes

* This is a pre-release library, so breaking changes for api ergonomics are encouraged. Do not worry about backwards compatibility until we hit semver 0.1.0

* Prefer typescript types to interfaces wherever possible.


* Put public apis at the top of the file and helper files towards the bottom. eg

```ts
export class MyThing {


}

export function myOtherThing() {
  someHelperFunction();
}

function someHelperFunction() { ... }
```

* Test-drive outside-in: First write integration tests in `packages/bloop/test` that cover the user-facing apis. Then write unit tests in zig for internal modules as needed to fulfill the integration tests.

## Crash Loud and Early

This codebase follows "crash-only" design. Invalid states should trigger immediate panics, not silent no-ops.

WRONG (silent failure):
if (valid_condition) { do_thing(); }

RIGHT (explicit crash on invalid):
if (!valid_condition) @panic("explanation");
do_thing();

Never silently skip logic or return default values (unless explicitly instructed to do so). If a condition "shouldn't happen," that's exactly when we need to crash to catch bugs early.

Assert preconditions at function entry. Use @panic in zig or throw in ts for invariant violations.
Treat "impossible" conditions as bugs that must crash, not edge cases to handle gracefully.

Think of unexpected conditions as bugs in the caller, not runtime variations to handle.
Crashing is the correct behavior—it surfaces bugs immediately and makes it easier to trace unexpected behavior rather than letting them propagate.
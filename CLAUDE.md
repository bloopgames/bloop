# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Bloop?

Bloop is a rewindable 2D game simulation library. It enables:
- Writing game state and logic in TypeScript
- Rewinding any live or recorded gameplay session
- Hot reloading code changes during rewinded play sessions
- Rollback netcode (in development)

## Build & Development Commands

Use Bun exclusively (not npm/yarn/pnpm/node):

```bash
# Install dependencies
bun install

# Run all dev servers
bun run dev

# Type checking
bun run ci:tsc

# Run tests
bun test

# Run a single test file
bun test packages/bloop/test/bloop.test.ts

# Build engine WASM (requires zig)
cd packages/engine && zig build -p .

# Watch engine WASM during development
cd packages/engine && zig build -p . --watch

# Run a specific game dev server
cd games/quickdraw && bun run dev
```

## Monorepo Structure

**Packages (publishable libraries):**
- `packages/engine` - Zig WASM core that handles time, inputs, events, snapshots, and tape recording
- `packages/bloop` - TypeScript game framework (`@bloopjs/bloop`) - the main API for creating games
- `packages/web` - Browser runtime (`@bloopjs/web`) - handles RAF loop, DOM events, HMR

**Games (example apps):**
- `games/hello` - Minimal example game
- `games/quickdraw` - Vue-based game with netcode (uses Vite, not Bun.serve)

## Architecture

### Core Concepts

**Bloop** - Main game class created via `Bloop.create({ bag: {...} })`. The `bag` is singleton game state that gets serialized for snapshots/rollback.

**System** - Game logic registered via `game.system("name", { update, keydown, mousedown, ... })`. Systems receive a `Context` with `bag`, `time`, and `inputs`.

**Sim** - Simulation runner that wraps the WASM engine. Handles stepping frames forward/backward, recording/replaying tapes, and snapshotting state.

**App** (web only) - Browser runtime that connects DOM events to the Sim and runs the RAF loop. Handles HMR via `app.acceptHmr()`.

### Data Flow

1. Browser events captured by `App` -> emit to `Sim`
2. `Sim.step()` calls WASM engine which processes inputs and fires callback
3. WASM callback invokes TypeScript systems with current `Context`
4. Systems read `context.inputs` and mutate `context.bag`
5. Engine snapshots bag via `serialize`/`deserialize` hooks for rewind capability

### Engine (Zig/WASM)

The engine in `packages/engine/src/*.zig` manages:
- Time context (frame, dt, elapsed time)
- Input state (keyboard/mouse)
- Event queue
- Tape recording/playback
- Snapshot/restore

TypeScript interacts with WASM through `WasmEngine` interface. The `mount()` function instantiates WASM and wires up callbacks.

## Testing Pattern

```typescript
import { describe, expect, it } from "bun:test";
import { Bloop, mount } from "@bloopjs/bloop";

it("test name", async () => {
  const game = Bloop.create({ bag: { value: 0 } });
  game.system("test", {
    update({ bag }) { bag.value++; }
  });

  const { sim } = await mount(game);
  sim.step(16);
  expect(game.bag.value).toBe(1);
});
```

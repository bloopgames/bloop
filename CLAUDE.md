See `.claude/Q1_2025_ROADMAP.md` for current priorities.

## Build & Development Commands

Use Bun exclusively (not npm/yarn/pnpm/node):
```bash
bun install                # Install dependencies
bun run ci                 # Run all checks
bun run ci:tsc             # Type checking
bun test                   # Run ts tests
bun test path/to/file.ts   # Run single test file

# Engine (Zig/WASM)
cd packages/engine
bun run build:wasm         # Build
bun dev                    # Watch during development
zig build test             # Run engine tests

# Games
cd games/buzzer && bun run dev

# Deploy to trybloop.gg
bun run website
```

## Monorepo Structure

**Packages:**
- `packages/bloop` - TypeScript game framework (`@bloopjs/bloop`). Speed of expression is the north star. Integration tests for user-facing APIs.
- `packages/engine` - Zig core handling time, inputs, events, snapshots, tape recording. Performance is the north star. High-coverage unit tests.
- `packages/web` - Browser runtime (`@bloopjs/web`). RAF loop, DOM events, HMR. Playwright smoke tests.

**Games:** `games/hello`, `games/buzzer`, `games/mario`

## Architecture

### Core Concepts

**Bloop** - `Bloop.create({ bag: {...} })`. Bag is singleton game state, serialized for snapshots/rollback.

**System** - `game.system("name", { update, keydown, mousedown, ... })`. Systems receive `Context` with `bag`, `time`, `inputs`.

**Sim** - Wraps WASM engine. Handles stepping frames, recording/replaying tapes, snapshotting. `sim.seek(frame)` uses absolute frame numbers—if recording started at frame 3, seek to 3 for tape start.

**App** (web only) - Connects DOM events to Sim, runs RAF loop. HMR via `app.acceptHmr()`.

### Data Flow

1. Platform events captured by `App` → emit to `Sim`
2. `Sim.step()` calls WASM engine, fires callback
3. Callback invokes TypeScript systems with `Context`
4. Systems use `context.time`, `context.net`, `context.players`, mutate `context.bag`
5. Engine snapshots bag via `serialize`/`deserialize` hooks

### Engine (Zig/WASM)

Rebuild: `bun run build:wasm`

Manages time, multiplayer input states, event queue, tape recording/playback, snapshot/restore.

Prefer one explicit way over ergonomic APIs. Exported WASM functions must be listed in build.zig.

WASM exports return `0`/`1` for booleans—wrap with `Boolean()` in TypeScript.

Each WASM page is 64KB. When adding static allocations, run `wasm-objdump -j Import -x zig-out/wasm/bloop.wasm` to check required initial pages and update mount.ts.

WASM extern callbacks use double-underscore prefix (`__systems`, `__before_frame`, `__user_data_len`) to avoid shadowing. Callbacks receive context pointer as first argument.

Logging: `Log.log("Message: {d}", .{value});` outputs to browser console.

### Context Pattern

When exposing engine data to TypeScript, follow the DataView pattern used by `TimeContext`, `InputContext`, `NetContext`.

## Integration Testing

Run: `bun test`

```ts
import { describe, expect, it } from "bun:test";
import { Bloop, mount } from "@bloopjs/bloop";

it("test name", async () => {
  const game = Bloop.create({ bag: { value: 0 } });
  game.system("test", { update({ bag }) { bag.value++; } });
  const { sim } = await mount(game);
  sim.step(16);
  expect(game.bag.value).toBe(1);
});
```

### E2E Testing

Smoke tests only—slow (~5-10s each). One test checking multiple things > multiple similar tests. Assert on screenshots, not internal JS state. Use `window.__BLOOP_APP__` only when visual assertions aren't practical. Target: suite < 20s on CI.

Run: `bun run ci:e2e`


## Development Notes

- Pre-release: breaking changes for ergonomics are encouraged
- Prefer types over interfaces
- Public APIs at top of file, helpers at bottom
- Test-drive outside-in: integration tests in `packages/bloop/test` first, then unit tests in Zig as needed.

## TDD (when requested)

RED → GREEN → REFACTOR. Never write implementation and test in same response.

1. **RED**: Write failing test, run it, show failure. Stop and wait for confirmation.
2. **GREEN**: Minimal code to pass. Run test.
3. **REFACTOR**: Only after green.

## Tape Repro

When given a tape that reproduces an issue, try running `bin/inspect-tape.ts` to see metadata. You can also load the tape using `loadTape` from the test helpers.

## Surface Surprises During Plan Execution

When executing with Accept Edits on, if you deviate from the plan (API changes, missing dependencies, type mismatches, unexpected structures), document in summary:
1. Original expectation
2. What you encountered
3. Workaround chosen and why

## Crash Loud and Early

Invalid states trigger immediate panics, not silent no-ops.
```zig
// WRONG: silent failure
if (valid) { do_thing(); }

// RIGHT: crash on invalid
if (!valid) @panic("expected X, got Y");
do_thing();
```

Assert preconditions at function entry. Treat "impossible" conditions as caller bugs. Panic/throw messages should include the invalid value and expected constraint.
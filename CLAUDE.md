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
    update({ bag }) {
      bag.value++;
    },
  });

  const { sim } = await mount(game);
  sim.step(16);
  expect(game.bag.value).toBe(1);
});
```

## General Guidelines

In typescript code, avoid silently failing unless explicitly requested to swallow an error. Unexpected null/undefined values should use `assert` or `unwrap` from the `@bloopjs/bloop` package. During this phase of development it is better to crash at runtime than to continue in an invalid or unexpected state.

Prefer typescript types to interfaces wherever possible.

## Rendering

While bloop has no rendering capabilities, games you can't see are not very fun to play.

A lot of examples use Toodle for rendering (imported from `@bloopjs/toodle`). Toodle is a simple immediate-mode 2D canvas rendering library. It provides primitives for drawing shapes, text, and images.

Toodle's coordinate system has the origin (0,0) at the center of the canvas, with positive Y going upwards. This is different from the default HTML canvas coordinate system where (0,0) is at the top-left and positive Y goes downwards.

Examples copied from the documentation website for basic functionality:

### Basic quads with hierarchy

```typescript
import { Toodle } from "@bloopjs/toodle";

// attach toodle
const canvas = document.querySelector("canvas")!;
const toodle = await Toodle.attach(canvas, {
  filter: "nearest",
  limits: { textureArrayLayers: 5 },
});

toodle.clearColor = { r: 0, g: 0, b: 0, a: 1 };

// load textures
await toodle.assets.loadTextures({
  mario: new URL("https://toodle.gg/img/MarioIdle.png"),
  mushroom: new URL("https://toodle.gg/img/Mushroom.png"),
});

// You can use a node that doesn't draw anything as a parent
const root = toodle.Node({
  position: { x: 40, y: 40 },
});
// Every node has an `add` method that returns the node that was added
const mario = root.add(toodle.Quad("mario"));
const mushroom = mario.add(
  toodle.Quad("mushroom", {
    // children's positions are in local space relative to the parent
    position: { x: 24, y: 0 },
  }),
);

function frame() {
  toodle.startFrame();
  mario.scale = 3 + Math.sin(toodle.frameCount / 30);
  mario.rotation += 1;
  mushroom.rotation += 1;
  toodle.draw(mario);
  toodle.endFrame();
  requestAnimationFrame(frame);
}

frame();
```

### Hello world text

```ts
import { Toodle } from "@bloopjs/toodle";

const canvas = document.querySelector("canvas")!;
const toodle = await Toodle.attach(canvas, {
  limits: { textureArrayLayers: 5 },
});

const fontId = await toodle.assets.loadFont(
  "ComicNeue",
  new URL("https://toodle.gg/fonts/ComicNeue-Regular-msdf.json"),
);

const text = toodle.Text("ComicNeue", "Hello World", {
  fontSize: 16,
  color: { r: 0, g: 0, b: 0, a: 1 },
});

function frame() {
  toodle.startFrame();
  text.rotation += 1;
  toodle.draw(text);
  toodle.endFrame();

  requestAnimationFrame(frame);
}

frame();
```

### Basic shapes

```ts
import { Toodle } from "@bloopjs/toodle";

const canvas = document.querySelector("canvas")!;
const toodle = await Toodle.attach(canvas, {
  limits: { textureArrayLayers: 5 },
});

const shader = toodle.QuadShader(
  "line custom shader",
  1,
  /*wgsl*/ `

  @fragment
  fn frag(vertex: VertexOutput) -> @location(0) vec4f {
    let color = default_fragment_shader(vertex, nearestSampler);
    let uv = vertex.engine_uv.zw;
    return vec4f(uv.x, uv.y, 1, 1);
  }
    `,
);

function frame() {
  const thickness = 5;

  // basic line
  const basicLine = toodle.shapes.Line({
    start: { x: 0, y: 0 },
    end: { x: 0, y: 75 },
    thickness,
    color: { r: 1, g: 0, b: 1, a: 1 },
  });

  // line with custom shader
  const fancyLine = toodle.shapes.Line({
    start: { x: 0, y: 0 },
    end: {
      x: Math.sin(performance.now() / 1000) * 100,
      y: Math.cos(performance.now() / 1000) * 100,
    },
    thickness,
    color: { r: 1, g: 0, b: 1, a: 1 },
    shader,
  });

  const circle = toodle.shapes.Circle({
    color: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
    idealSize: { width: 200, height: 200 },
  });

  const rectangle = toodle.shapes.Rect({
    idealSize: { width: 500, height: 120 },
    color: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
  });

  toodle.startFrame();
  toodle.draw(rectangle);
  toodle.draw(circle);
  toodle.draw(basicLine);
  toodle.draw(fancyLine);
  toodle.endFrame();
  requestAnimationFrame(frame);
}

frame();
```

### Sprite sheets and animation

```typescript
// Load a sprite sheet
await toodle.assets.loadTextures({
  marioWalk: new URL("/sprites/MarioWalk.png", window.location.href),
});

// Create a quad with region for sprite sheet frame selection
const sprite = toodle.Quad("marioWalk", {
  idealSize: { width: 16, height: 16 },
  region: { x: 0, y: 0, width: 16, height: 16 },
});

// Animate by updating region.x to select frame
sprite.region.x = frameIndex * 16;
```

### Node visibility

Use `isActive` to show/hide nodes (not `hidden` or `visible`):

```typescript
node.isActive = false; // hides the node
node.isActive = true;  // shows the node
```

### Scaling with pixel art

Use `filter: "nearest"` when attaching Toodle for crisp pixel art:

```typescript
const toodle = await Toodle.attach(canvas, { filter: "nearest" });
```

### Common patterns

- Create nodes once in setup, update their properties each frame (immediate-mode style but with persistent objects)
- Use a root `toodle.Node()` with `scale` to uniformly scale the entire scene
- Position is always the center of the node
- Colors use `{ r, g, b, a }` with values 0-1, or use `Colors.web.*` helpers
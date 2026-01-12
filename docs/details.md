# Technical Details

## Hello World

This example uses default input mappings to spawn and move a purple box on the screen.

```ts
import { Bloop, Colors } from '@bloop.gg/bloop'

// when defining your Bloop, you can specify singleton game state, ECS components, input maps and more. here we are just using the defaults.
export const game = new Bloop({})

// spawn a box with a default transform at the origin on frame 0
game.system('spawnPlayer', {
  once({engine}) {
    engine.spawn({
      transform: {},
      rect: {
        color: Colors.purple,
        size: {
          width: 100
        }
      }
    })
  }
})

// each frame, move the player based on input
game.system('move', {
  query: {
    position: 'write'
  },
  move({event, query}) {
    for (const q of query) {
      q.position.move(event)
    }
  },
})
```

This simulation is runnable and testable headlessly:

```ts
import { game } from '../src/game.ts'
import { mount } from "@bloop.gg/bloop/headless"
import { expect, it } from 'bun:test'

it('moves the player right when the right arrow key is pressed', async () => {
  const {runtime, query, inputEmitter} = await mount(game)

  runtime.step()

  const player = query({
    position: 'read'
  }).first()
  expect(player.position.x).toEqual(0)

  emitter.keydown('ArrowRight')
  runtime.step()

  const player = query({
    position: 'read'
  }).first()
  expect(player.position.x).toEqual(1)
```

On the web, you can mount to a canvas and use your renderer of choice:

```ts
import { game } from './src/game.ts'
import { mount } from "@bloop.gg/bloop/web"
import { renderer } from "@bloop.gg/bloop/toodle"

const canvas = document.querySelector<HTMLCanvasElement>('canvas');

await mount(game, {
  canvas,
  renderer
})
```

On native, you can create a native entrypoint with `bun --compile`

```ts
import { game } from './src/game.ts'
import { mount } from "@bloop.gg/bloop/native"

await mount(game)
```


### Step forward (live)


1. Platform receives input events
2. Platform adapter encodes input events to binary tape format
3. Your game logic updates game state
4. Render adapter draws the current game state


### Step backward (rewind)

1. Bloop loads state of previous frame to linear memory
2. Tape replays binary input events
3. Your game logic updates game state
4. Render adapter draws the current game state

### Browser

1. DOM events used for input
2. Engine loaded as WASM
3. Game code bundled with web app

### Desktop

1. Native events used for input
2. Entrypoint created with `bun --compile`
3. Engine loaded as WASM or native .dll / .so / .dylib

### Mobile (web renderer)

1. Game loaded in a WKWebView or Android WebView

### Mobile (native renderer)

1. Game loaded via JSC
2. Engine compiled as a .dylib
3. Native events used for input

### Nintendo Switch

nda'd. at a high level, the language that runs on consoles is the platform adapter, and the games javascript is bundled in such a way that it is runnable in the console environment.
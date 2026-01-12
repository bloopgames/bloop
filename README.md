# bloop

**Rewind game sessions and edit code live.**

[Why Bloop?](./docs/why.md)

[insert gif here]

## Quickstart

bloop has 0 dependencies. Experiment with it in 30 seconds.

```bash
bun create bloop@latest
```

## Hello World

**game.ts**

Game logic is in portable, headless TypeScript files with no dependencies on the browser or renderer.

```ts
import { Bloop } from "@bloopjs/bloop";

export const game = Bloop.create({
  // bag is a singleton object for global game state - useful for prototyping
  bag: {
    clicks: 0,
  }
})

// game systems run in the order you define them
game.system('input', {
  // systems updates state in response to events
  //
  // * input events like keydown, mousemove
  // * frame lifecycle events like update
  // * network events like peer join
  mousedown({event, bag}) {
    bag.clicks++;
    console.log(`Clicked ${bag.clicks} times!`)
  },
})
```

### Run on the web

**main.ts**

To run on the web, use the `@bloopjs/web` package.

```ts
import { start } from "@bloopjs/web";
import { game } from "./game";

// start the game and hook into requestAnimationFrame for stepping
const app = await start(game)

// wire up hot module reloading for changing game code without losing state
import.meta.hot?.accept("./game", async (newModule) => {
  await app.acceptHmr(newModule?.game);
});
```

### Run in tests

**test/game.test.ts**

All game code is unit testable.

```ts
import { expect, it } from "bun:test";
import { mount } from "@bloopjs/bloop"
import { game } from "../game"

it('registers clicks', async () => {
  const {sim} = await mount(game);

  sim.step();
  expect(game.bag.clicks).toEqual(0);

  sim.emit.mousedown('left');
  sim.step();
  expect(game.bag.clicks).toEqual(1);
})
```

### Run in godot

Working on this for Q1 2026. Follow along in the [discord](https://discord.gg/qQHZQeFYXF).

## Rollback Netcode

### What is rollback netcode?

Rollback netcode is a technique for online multiplayer networking that synchronizes inputs instead of state.

* See this [ excellent rollback explainer](https://bymuno.com/post/rollback) by [Muno](https://bymuno.com/)

* Try out this [demo of a 2 player mario game](https://trybloop.gg/nu11/mario) ([source code](./games/mario/src/game.ts)) inspired by muno's post.

### How to add rollback netcode to your game

It's easy to create an online multiplayer action game for 2-12 players with bloop, thanks to the rewindable architecture used by tapes.

If you have a local multiplayer game, you can make it work as an online multiplayer game with 20 lines of code.

With these controls for a simple pong-like:

```ts
game.system('gameplay', {
  update({players, bag}) {
    if (players[0].keys.arrowUp.held) {
      bag.leftPaddle.y += 5;
    }
    if (players[0].keys.arrowDown.held) {
      bag.leftPaddle.y -= 5;
    }
    if (players[1].keys.w.held) {
      bag.rightPaddle.y += 5;
    }
    if (players[1].keys.s.held) {
      bag.rightPaddle.y -= 5;
    }
  }
})
```

You can add rollback netcode like this:

```ts
game.system('matchmaking', {
  keydown({event, net, bag}) {
    // create or join a room called 'TEST'
    if (event.key == 'Enter') {
      net.wantsRoomCode = 'TEST'
      bag.status = 'Waiting for opponent...'
    }
  },

  netcode({event}) {
    // a rollback session is started when someone else joins the room
    if (event.type === 'session:start') {
      bag.status = 'Opponent joined! Start game'
    }
  }
})
```

Under the hood, bloop will:

* use a websocket server for signaling

* establish a peer-to-peer connection using WebRTC

* send packets each frame with unacked local inputs

* listen for incoming packets and track confirmed state

* listen for packet events and reconcile inputs between peers

* perform rollback and resimulation using your game systems

## Contributing

To get started developing bloop locally:


**Mac/Linux**

```bash
./bin/setup
```

**Windows (Powershell)**

```powershell
.\bin\setup.ps1
```

## Built with Bloop

https://trybloop.gg has examples of game demos I've built with bloop, you can play them live in the browser or check out their [source code](./games/).

Contributions welcome!

## Features

- Unit testable
- Record gameplay "tapes"
- Rewind any live or recorded gameplay session
- Hot reload code changes during a rewinded play session
- Rollback netcode

## Roadmap

### Q1 2026

#### Game Logic - Q1 2026

- [x] Keyboard and Mouse Input Handling
- [ ] Animated Sprites
- [ ] Transform Hierarchy
- [ ] Collision detection
- [ ] Cameras
- [ ] ECS
- [ ] Scene Loading
- [ ] Gameplay phases
- [ ] Feature flags
- [ ] Config values
- [ ] Gamepad (aka controller) input handling

#### Rendering Adapters - Q1 2026

- [ ] Godot
- [ ] [Toodle](https://toodle.gg)

#### Platform Targets

- [x] Browser
- [ ] PC
- [ ] Desktop Mac
- [ ] iOS
- [ ] Steam Deck
- [ ] Nintendo Switch
- [ ] Run anywhere you can allocate a byte buffer

### Performance

- [ ] Single frame object pools
- [ ] Multithreading

### Editing Integrations

- [ ] Aseprite
- [ ] LDtk
- [ ] VSCode / Cursor

--

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

# bloop

**Rewind game sessions and edit code live.**

[Why Bloop?](./why.md)

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

Rollback netcode is built in using the same mechanism used to create tapes and snapshots, so if you wrote a local multiplayer game it'll work as an online multiplayer game with 10 new lines of code.

See https://trybloop.gg/nu11/mario for a demo of local multiplayer mario with working rollback netcode for 2 players.

Demo inspired by the excellent [rollback explainer](https://bymuno.com/post/rollback) by [Muno](https://bymuno.com/).

## One Week Challenge

If you're an indie dev who has shipped games and is working on a game written in TypeScript and is intrigued by one or all of:

* time travel debugging with hot reload

* realtime online multiplayer with rollback netcode

* porting to difficult native platforms, including mobile or console

I bet I can integrate bloop into your game for free in one week or less without a rewrite of your game code.

Hit me up on [discord](https://discord.gg/qQHZQeFYXF) to claim one of 3 spots.

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

---
sidebar_position: 2
---

# Hello World

## Game Logic

Game logic lives in portable, headless TypeScript files with no dependencies on the browser or renderer.

**game.ts**

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
  // systems update state in response to events:
  // * input events like keydown, mousemove
  // * frame lifecycle events like update
  // * network events like peer join
  mousedown({event, bag}) {
    bag.clicks++;
    console.log(`Clicked ${bag.clicks} times!`)
  },
})
```

## Run on the Web

To run on the web, use the `@bloopjs/web` package.

**main.ts**

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

## Run in Tests

All game code is unit testable.

**test/game.test.ts**

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

## Run in Godot

Working on this for Q1 2026. Follow along in the [Discord](https://discord.gg/qQHZQeFYXF).

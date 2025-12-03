import { beforeEach, describe, expect, it } from "bun:test";
import { mount } from "@bloopjs/bloop";
import { game } from "../src/game";

const defaultBag = { ...game.bag };

describe("buzzer game", () => {
  beforeEach(() => {
    // Reset bag properties individually since bag is readonly
    Object.assign(game.bag, defaultBag);
  });

  it("should start with a fixed time", async () => {
    const { sim } = await mount(game);

    expect(game.bag.buzzDelay).toEqual(3);
  });

  it("should start in waiting phase", async () => {
    const { sim } = await mount(game);

    expect(game.bag.phase).toEqual("waiting");
    expect(game.bag.timer).toEqual(0);
    expect(game.bag.player1Score).toEqual(0);
    expect(game.bag.player2Score).toEqual(0);
  });

  it("should oscillate block position", async () => {
    const { sim } = await mount(game);

    const initialX = game.bag.blockX;
    sim.step(100); // Step 100ms
    expect(game.bag.blockX).not.toEqual(initialX);
    expect(game.bag.blockX).toBeGreaterThan(initialX);
  });

  it("should transition to active phase after buzz delay", async () => {
    const { sim } = await mount(game);

    expect(game.bag.phase).toEqual("waiting");
    expect(game.bag.timer).toEqual(0);

    // Step past the delay (3100ms should run ~193 frames at 16ms each = 3088ms total)
    sim.step(3100);

    expect(game.bag.phase).toEqual("active");
    expect(game.bag.timer).toBeGreaterThanOrEqual(0); // Timer resets when entering active phase
  });

  it("should lose if player clicks before active phase", async () => {
    const { sim } = await mount(game);

    expect(game.bag.phase).toEqual("waiting");

    // Player 1 clicks too early
    sim.emit.keydown("KeyA");
    sim.step();

    expect(game.bag.phase).toEqual("lost");
    expect(game.bag.player1Score).toEqual(0);
    expect(game.bag.player2Score).toEqual(0);
  });

  it("should award point to player 1 who clicks first in active phase", async () => {
    const { sim } = await mount(game);

    // Wait for active phase
    sim.step(3100);
    expect(game.bag.phase).toEqual("active");

    // Player 1 clicks
    sim.emit.keydown("KeyA");
    sim.step();

    expect(game.bag.phase).toEqual("won");
    expect(game.bag.winner).toEqual(1);
    expect(game.bag.player1Score).toEqual(1);
    expect(game.bag.player2Score).toEqual(0);
  });

  it("should award point to player 2 who clicks first in active phase", async () => {
    const { sim } = await mount(game);

    // Wait for active phase
    sim.step(3100);
    expect(game.bag.phase).toEqual("active");

    // Player 2 clicks
    sim.emit.keydown("KeyL");
    sim.step();

    expect(game.bag.phase).toEqual("won");
    expect(game.bag.winner).toEqual(2);
    expect(game.bag.player1Score).toEqual(0);
    expect(game.bag.player2Score).toEqual(1);
  });

  it("should reset to waiting phase after winner display time", async () => {
    const { sim } = await mount(game);

    // Get to active phase and win
    sim.step(3100);
    sim.emit.keydown("KeyA");
    sim.step();

    expect(game.bag.phase).toEqual("won");
    expect(game.bag.winner).toEqual(1);

    // Wait for winner display time
    sim.step(600);

    expect(game.bag.phase).toEqual("waiting");
    expect(game.bag.winner).toEqual(null);
    expect(game.bag.player1Score).toEqual(1); // Score persists
  });

  it("should support mouse click for player 1", async () => {
    const { sim } = await mount(game);

    // Wait for active phase
    sim.step(3100);
    expect(game.bag.phase).toEqual("active");

    // Player 1 clicks mouse
    sim.emit.mousedown("Left");
    sim.step();

    expect(game.bag.phase).toEqual("won");
    expect(game.bag.winner).toEqual(1);
    expect(game.bag.player1Score).toEqual(1);
  });
});

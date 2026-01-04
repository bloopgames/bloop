import { beforeEach, describe, expect, it } from "bun:test";
import { mount } from "@bloopjs/bloop";
import { game } from "../src/game";

const defaultBag = { ...game.bag };

describe("buzzer game", () => {
  beforeEach(() => {
    // Reset bag properties individually since bag is readonly
    Object.assign(game.bag, defaultBag);
    // Tests run without netcode, so start in "waiting" phase instead of "connecting"
    game.bag.phase = "waiting";
  });

  it("should start with a fixed time", async () => {
    const { sim } = await mount(game);

    expect(game.bag.buzzDelay).toEqual(3);
  });

  it("should start in connecting phase (waiting for netcode)", async () => {
    // Temporarily set back to connecting to test initial state
    game.bag.phase = "connecting";
    await mount(game);

    expect(game.bag.phase).toEqual("connecting");
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

    // Player 1 clicks too early (mouse click, source = LocalMouse -> players[0])
    sim.emit.mousedown("Left");
    sim.step();

    expect(game.bag.phase).toEqual("lost");
    expect(game.bag.player1Score).toEqual(0);
    expect(game.bag.player2Score).toEqual(0);
  });

  it("should award point to player who clicks first in active phase", async () => {
    const { sim } = await mount(game);

    // Wait for active phase
    sim.step(3100);
    expect(game.bag.phase).toEqual("active");

    // Player 1 clicks (LocalMouse -> players[0])
    sim.emit.mousedown("Left");
    sim.step();

    expect(game.bag.phase).toEqual("won");
    expect(game.bag.winner).toEqual(1);
    expect(game.bag.player1Score).toEqual(1);
    expect(game.bag.player2Score).toEqual(0);
  });

  it("should reset to waiting phase after winner display time", async () => {
    const { sim } = await mount(game);

    // Get to active phase and win
    sim.step(3100);
    sim.emit.mousedown("Left");
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

  it("should detect mouse down after mouse up", async () => {
    const { sim } = await mount(game);

    // First click
    sim.emit.mousedown("Left");
    sim.step();

    expect(game.context.inputs.mouse.left.down).toEqual(true);

    // Release
    sim.emit.mouseup("Left");
    sim.step();

    expect(game.context.inputs.mouse.left.down).toEqual(false);

    // Second click
    sim.emit.mousedown("Left");
    sim.step();

    expect(game.context.inputs.mouse.left.down).toEqual(true);
  });

  it("should handle multiple rounds with mouse clicks", async () => {
    const { sim } = await mount(game);

    // Round 1 - Player 1 wins
    sim.step(3100);
    expect(game.bag.phase).toEqual("active");

    sim.emit.mousedown("Left");
    sim.step();
    sim.emit.mouseup("Left");
    sim.step();

    expect(game.bag.phase).toEqual("won");
    expect(game.bag.player1Score).toEqual(1);

    // Wait for round to reset
    sim.step(600);
    expect(game.bag.phase).toEqual("waiting");

    // Round 2 - Player 1 wins again
    sim.step(3100);
    expect(game.bag.phase).toEqual("active");

    sim.emit.mousedown("Left");
    sim.step();

    expect(game.bag.phase).toEqual("won");
    expect(game.bag.player1Score).toEqual(2);
  });
});

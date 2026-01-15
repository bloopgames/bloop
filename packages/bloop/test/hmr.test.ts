import { describe, expect, it } from "bun:test";
import { Bloop } from "../src/bloop";
import { mount } from "../src/mount";
import { doHmr } from "./helper";

const makeTrackingGame = () => {
  const game = Bloop.create({ bag: { x: 0, y: 0 } });
  game.system("track", {
    update({ bag, inputs }) {
      bag.x = inputs.mouse.x;
      bag.y = inputs.mouse.y;
    },
  });
  return game;
};

const makePhaseGame = () => {
  const game = Bloop.create({ bag: { phase: "title" as string } });
  game.system("progression", {
    update({ bag, inputs }) {
      if (bag.phase === "title" && inputs.keys.space.down) {
        bag.phase = "playing";
      }
    },
  });
  return game;
};

describe("HMR (cloneSession)", () => {
  it("transfers tape and accepts new inputs after HMR", async () => {
    const { sim } = await mount(makeTrackingGame(), { startRecording: true });
    sim.emit.mousemove(10, 20);
    sim.step();

    const { sim: newSim, game: newGame } = await doHmr(makeTrackingGame, sim);

    expect(newGame.bag).toEqual({ x: 10, y: 20 });
    newSim.emit.mousemove(30, 40);
    newSim.step();
    expect(newSim.isReplaying).toBe(false);
    expect(newGame.bag).toEqual({ x: 30, y: 40 });
  });

  it("preserves paused state after HMR", async () => {
    const { sim } = await mount(makeTrackingGame(), { startRecording: true });
    sim.emit.mousemove(10, 20);
    sim.step();
    sim.pause();

    const { sim: newSim, game: newGame } = await doHmr(makeTrackingGame, sim);

    expect(newGame.bag).toEqual({ x: 10, y: 20 });
    expect(newSim.isPaused).toBe(true);
  });

  it("transfers tape in replay mode (loaded tape file)", async () => {
    // Create and save a tape with a state transition
    const game = makePhaseGame();
    const { sim } = await mount(game, { startRecording: true });
    for (let i = 0; i < 10; i++) sim.step();
    sim.emit.keydown("Space");
    sim.step();
    expect(game.bag.phase).toBe("playing");
    sim.emit.keyup("Space");
    for (let i = 0; i < 20; i++) sim.step();
    const tape = sim.saveTape();
    sim.unmount();

    // Load tape in replay mode (simulates drag-drop in UI)
    const replayGame = makePhaseGame();
    const { sim: replaySim } = await mount(replayGame, { startRecording: false });
    replaySim.loadTape(tape);
    replaySim.seek(25);
    expect(replayGame.bag.phase).toBe("playing");
    expect(replaySim.isReplaying).toBe(true);
    expect(replaySim.isRecording).toBe(false);
    replaySim.pause();

    // HMR while in replay mode
    const { sim: hmrSim, game: hmrGame } = await doHmr(makePhaseGame, replaySim);

    expect(hmrGame.bag.phase).toBe("playing");
    expect(hmrSim.time.frame).toBe(25);

    hmrSim.seek(hmrSim.time.frame + 1);
    expect(hmrGame.bag.phase).toBe("playing");
    expect(hmrSim.time.frame).toBe(26);
  });
});

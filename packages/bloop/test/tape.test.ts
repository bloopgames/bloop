import { describe, expect, it } from "bun:test";
import { Bloop, mount } from "../src/mod";

describe("tapes", () => {
  describe("tape overflow", () => {
    it("should stop recording gracefully when tape is full", async () => {
      const game = Bloop.create({ bag: { count: 0 } });
      let tapeFull = false;
      let savedTape: Uint8Array | null = null;

      const { sim } = await mount(game, {
        tape: { maxEvents: 10 },
      });

      sim.onTapeFull = (tape) => {
        tapeFull = true;
        savedTape = tape;
      };

      // Spam events to fill tape quickly - each keydown/keyup is 2 events, plus frame start
      for (let i = 0; i < 20; i++) {
        sim.emit.keydown("KeyA");
        sim.step();
        sim.emit.keyup("KeyA");
      }

      // Should not crash - game continues
      expect(tapeFull).toBe(true);
      expect(savedTape).not.toBeNull();
      expect(sim.isRecording).toBe(false);
      expect(game.context.time.frame).toBeGreaterThan(5);
    });

    it("can restart recording from within onTapeFull callback", async () => {
      const game = Bloop.create({ bag: { count: 0 } });
      let restartCount = 0;

      const { sim } = await mount(game, {
        tape: { maxEvents: 10 },
      });

      sim.onTapeFull = () => {
        restartCount++;
        // Restart recording with fresh tape
        sim.record(10);
      };

      // Fill tape multiple times
      for (let i = 0; i < 50; i++) {
        sim.emit.keydown("KeyA");
        sim.step();
        sim.emit.keyup("KeyA");
      }

      // Should have restarted recording multiple times
      expect(restartCount).toBeGreaterThan(0);
      expect(sim.isRecording).toBe(true);
    });

    it.skip("restarted recordings have valid tape data (TODO - write this)", async () => {});

    it("can start recording mid-game", async () => {
      const game = Bloop.create({
        bag: { score: 0 },
      });

      game.system("scorer", {
        keydown({ event, bag }) {
          if (event.key === "Space") {
            bag.score += 10;
          }
        },
      });

      // Start without recording
      const { sim } = await mount(game, { startRecording: false });
      expect(sim.isRecording).toBe(false);

      // Play for a bit without recording (frames 0->1, 1->2, 2->3)
      sim.step();
      sim.step();
      sim.emit.keydown("Space");
      sim.step();
      expect(game.bag.score).toBe(10);
      expect(game.context.time.frame).toBe(3);

      // Now start recording mid-game at frame 3
      sim.record(100);
      expect(sim.isRecording).toBe(true);

      // Score more points while recording (frames 3->4, 4->5)
      sim.emit.keyup("Space");
      sim.step();
      sim.emit.keydown("Space");
      sim.step();
      expect(game.bag.score).toBe(20);
      expect(game.context.time.frame).toBe(5);

      // Can save tape successfully
      const tape = sim.saveTape();
      expect(tape.length).toBeGreaterThan(0);

      // Verify tape can be loaded in a fresh sim and replayed correctly
      const { sim: sim2 } = await mount(game);
      sim2.loadTape(tape);

      // At frame 3 (start of recording), score should be 10
      sim2.seek(3);
      expect(game.bag.score).toBe(10);

      // At frame 5 (end of recording), score should be 20
      sim2.seek(5);
      expect(game.bag.score).toBe(20);
    });

  });

  describe("snapshots", () => {
    it("can snapshot the bag", async () => {
      const bloop = Bloop.create({
        bag: {
          cool: 42,
        },
      });

      bloop.system("inc", {
        update({ bag }) {
          bag.cool++;
        },
      });

      const { sim } = await mount(bloop);
      sim.step();

      expect(bloop.bag.cool).toEqual(43);
      const snapshot = sim.snapshot();

      sim.step();
      expect(bloop.bag.cool).toEqual(44);

      sim.restore(snapshot);
      expect(bloop.bag.cool).toEqual(43);
    });

    it("can snapshot the bag on frame 0", async () => {
      const bloop = Bloop.create({
        bag: {
          score: 10,
        },
      });

      const { sim } = await mount(bloop);
      const snapshot = sim.snapshot();
      sim.restore(snapshot);
      expect(bloop.bag.score).toEqual(10);
    });

    it("snapshots time", async () => {
      const bloop = Bloop.create();

      const timeCheck = {
        dt: 0,
        time: 0,
        frame: 0,
      };

      bloop.system("timeCheck", {
        update({ time }) {
          timeCheck.dt = time.dt;
          timeCheck.time = time.time;
          timeCheck.frame = time.frame;
        },
      });

      const { sim } = await mount(bloop);

      sim.step();

      expect(timeCheck.dt).toBeCloseTo(0.016);
      expect(timeCheck.time).toBeCloseTo(0.016);
      expect(timeCheck.frame).toEqual(0);
      expect(bloop.context.time.frame).toEqual(1);

      // const snapshot = bloop.snapshot();
      const snapshot = sim.snapshot();

      sim.step();
      expect(timeCheck.dt).toBeCloseTo(0.016);
      expect(timeCheck.time).toBeCloseTo(0.016 * 2);
      expect(timeCheck.frame).toEqual(1);
      expect(bloop.context.time.frame).toEqual(2);

      sim.restore(snapshot);
      expect(bloop.context.time.frame).toEqual(1);
      sim.step();

      expect(timeCheck.dt).toBeCloseTo(0.016);
      expect(timeCheck.time).toBeCloseTo(0.016 * 2);
      expect(bloop.context.time.frame).toEqual(2);
    });
  });

  describe("playback", () => {
    it("can step back", async () => {
      const bloop = Bloop.create({
        bag: {
          clicks: 0,
        },
      });

      bloop.system("countClicks", {
        update({ bag, inputs, time }) {
          if (inputs.mouse.left.down) {
            bag.clicks++;
          }
        },
      });

      const { sim } = await mount(bloop);

      sim.emit.mousedown("Left");
      expect(bloop.context.time.frame).toEqual(0);
      expect(bloop.context.bag.clicks).toEqual(0);

      sim.step();
      expect(bloop.context.time.frame).toEqual(1);
      expect(bloop.bag.clicks).toEqual(1);

      sim.emit.mouseup("Left");
      sim.step();
      expect(bloop.context.time.frame).toEqual(2);
      expect(bloop.bag.clicks).toEqual(1);

      sim.stepBack();
      expect(bloop.context.time.frame).toEqual(1);
      expect(bloop.bag.clicks).toEqual(1);

      sim.stepBack();
      expect(bloop.context.time.frame).toEqual(0);
      expect(bloop.bag.clicks).toEqual(0);
    });

    it("regression - steps back after one frame", async () => {
      const game = Bloop.create({});
      const { sim } = await mount(game);

      sim.step();
      sim.step();
      sim.stepBack();

      expect(game.context.time.frame).toEqual(1);
    });
  });

  describe("serialization", () => {
    it("can serialize a tape to bytes and restore from it", async () => {
      const bloop = Bloop.create({
        bag: {
          score: 0,
        },
      });

      bloop.system("scoreSystem", {
        keydown({ event, bag }) {
          if (event.key === "Slash") {
            bag.score += 10;
          }
        },
      });

      const { sim } = await mount(bloop);

      sim.step();
      expect(bloop.bag.score).toEqual(0);
      expect(bloop.context.time.frame).toEqual(1);

      sim.emit.keydown("Slash");
      sim.step();
      expect(bloop.bag.score).toEqual(10);
      expect(bloop.context.time.frame).toEqual(2);

      sim.emit.keyup("Slash");
      sim.step();
      expect(bloop.bag.score).toEqual(10);
      expect(bloop.context.time.frame).toEqual(3);

      const tape = sim.saveTape();

      const { sim: sim1 } = await mount(bloop);
      sim1.loadTape(tape);

      // at the start of frame 2, score should be 10
      sim1.seek(2);
      expect(bloop.bag.score).toEqual(10);
      expect(bloop.context.time.frame).toEqual(2);

      sim1.step();
      expect(bloop.bag.score).toEqual(10);
    });
  });
});

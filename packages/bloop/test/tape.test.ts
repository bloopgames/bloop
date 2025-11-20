import { describe, expect, it } from "bun:test";
import { Bloop, mount } from "../src/mod";

describe("tapes", () => {
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

      const { runtime } = await mount(bloop);
      runtime.step();

      expect(bloop.bag.cool).toEqual(43);
      const snapshot = runtime.snapshot();

      runtime.step();
      expect(bloop.bag.cool).toEqual(44);

      runtime.restore(snapshot);
      expect(bloop.bag.cool).toEqual(43);
    });

    it("can snapshot the bag on frame 0", async () => {
      const bloop = Bloop.create({
        bag: {
          score: 10,
        },
      });

      const { runtime } = await mount(bloop);
      const snapshot = runtime.snapshot();
      runtime.restore(snapshot);
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

      const { runtime } = await mount(bloop);

      runtime.step();

      expect(timeCheck.dt).toBeCloseTo(0.016);
      expect(timeCheck.time).toBeCloseTo(0.016);
      expect(timeCheck.frame).toEqual(0);
      expect(bloop.context.time.frame).toEqual(1);

      // const snapshot = bloop.snapshot();
      const snapshot = runtime.snapshot();

      runtime.step();
      expect(timeCheck.dt).toBeCloseTo(0.016);
      expect(timeCheck.time).toBeCloseTo(0.016 * 2);
      expect(timeCheck.frame).toEqual(1);
      expect(bloop.context.time.frame).toEqual(2);

      runtime.restore(snapshot);
      expect(bloop.context.time.frame).toEqual(1);
      runtime.step();

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
        update({ bag, inputs }) {
          if (inputs.mouse.left.down) {
            bag.clicks++;
          }
        },
      });

      const { runtime } = await mount(bloop);

      runtime.emit.mousedown("Left");
      runtime.step();
      expect(bloop.context.time.frame).toEqual(1);
      expect(bloop.bag.clicks).toEqual(1);

      runtime.emit.mouseup("Left");
      runtime.step();
      expect(bloop.context.time.frame).toEqual(2);
      expect(bloop.bag.clicks).toEqual(1);

      runtime.stepBack();
      expect(bloop.context.time.frame).toEqual(1);
      expect(bloop.bag.clicks).toEqual(1);

      runtime.stepBack();
      expect(bloop.context.time.frame).toEqual(0);
      expect(bloop.bag.clicks).toEqual(0);
    });

    it("regression - steps back after one frame", async () => {
      const game = Bloop.create({});
      const { runtime } = await mount(game);

      runtime.step();
      runtime.step();
      runtime.stepBack();

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

      const { runtime } = await mount(bloop);

      runtime.step();
      expect(bloop.bag.score).toEqual(0);

      runtime.emit.keydown("Slash");
      runtime.step();
      expect(bloop.bag.score).toEqual(10);

      runtime.emit.keyup("Slash");
      runtime.step();
      expect(bloop.bag.score).toEqual(10);

      const tape = runtime.saveTape();

      const { runtime: runtime1 } = await mount(bloop);
      runtime1.loadTape(tape);

      runtime1.seek(1);
      expect(bloop.bag.score).toEqual(10);

      runtime1.step();
      expect(bloop.bag.score).toEqual(10);
    });
  });
});

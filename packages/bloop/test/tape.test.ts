import { it, expect, describe } from "bun:test";
import { mount } from "@bloopjs/engine";
import { Bloop } from "../src/mod";

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
      const snapshot = bloop.snapshot();

      runtime.step();
      expect(bloop.bag.cool).toEqual(44);

      bloop.restore(snapshot);
      expect(bloop.bag.cool).toEqual(43);
    });

    it("snapshots time", async () => {
      const bloop = Bloop.create({
        bag: {
          nope: 10,
        },
      });

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

      const snapshot = bloop.snapshot();

      runtime.step();
      expect(timeCheck.dt).toBeCloseTo(0.016);
      expect(timeCheck.time).toBeCloseTo(0.016 * 2);
      expect(timeCheck.frame).toEqual(1);
      expect(bloop.context.time.frame).toEqual(2);

      bloop.restore(snapshot);
      expect(bloop.context.time.frame).toEqual(1);
      runtime.step();

      expect(timeCheck.dt).toBeCloseTo(0.016);
      expect(timeCheck.time).toBeCloseTo(0.016 * 2);
      expect(bloop.context.time.frame).toEqual(2);
    });
  });
});

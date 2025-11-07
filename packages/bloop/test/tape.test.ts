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
  });
});

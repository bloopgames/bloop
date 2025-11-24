import { describe, expect, it } from "bun:test";
import { Bloop, mount } from "../src/mod";

describe("hmr", () => {
  describe("dump", () => {
    it("dumps a snapshot from the current game to the new game", async () => {
      const bloop0 = Bloop.create({
        bag: {
          score: 0,
        },
      });

      bloop0.system("increment", {
        update({ bag }) {
          bag.score++;
        },
      });

      const { sim: sim0 } = await mount(bloop0);

      sim0.step();
      sim0.step();
      expect(bloop0.bag.score).toEqual(2);
      expect(bloop0.context.time.frame).toEqual(2);

      const bloop1 = Bloop.create({
        bag: {
          score: 100,
        },
      });

      bloop1.system("increment", {
        update({ bag }) {
          bag.score += 2;
        },
      });

      const { sim: sim1 } = await mount(bloop1);
      sim1.restore(sim0.snapshot());

      expect(bloop1.bag.score).toEqual(2);
      expect(sim1.time.frame).toEqual(2);

      sim1.step();
      expect(bloop1.bag.score).toEqual(4);
      expect(bloop1.context.time.frame).toEqual(3);
    });

    it("allows dumping a tape and retaining session", async () => {
      const bloop0 = Bloop.create({
        bag: {
          score: 0,
        },
      });

      bloop0.system("increment", {
        update({ bag, inputs }) {
          if (inputs.keys.space.held) {
            bag.score++;
          }
        },
      });

      const { sim: sim0 } = await mount(bloop0);

      sim0.step();
      sim0.emit.keydown("Space");
      sim0.step();
      sim0.step();
      sim0.emit.keyup("Space");
      sim0.step();

      expect(bloop0.bag.score).toEqual(2);
      expect(bloop0.context.time.frame).toEqual(4);

      const bloop1 = Bloop.create({
        bag: {
          score: 0,
        },
      });

      bloop1.system("increment", {
        update({ bag, inputs }) {
          if (inputs.keys.space.held) {
            bag.score += 2;
          }
        },
      });

      const { sim: sim1 } = await mount(bloop1);
      sim1.loadTape(sim0.saveTape());

      sim1.seek(0);
      expect(bloop1.bag.score).toEqual(0);
      expect(sim1.time.frame).toEqual(0);

      sim1.seek(2);
      expect(bloop1.bag.score).toEqual(2);
      expect(bloop1.context.time.frame).toEqual(2);

      sim1.seek(3);
      expect(bloop1.bag.score).toEqual(4);
      expect(bloop1.context.time.frame).toEqual(3);

      sim1.seek(4);
      expect(bloop1.bag.score).toEqual(4);
      expect(bloop1.context.time.frame).toEqual(4);
    });
  });
});

import { describe, expect, it } from "bun:test";
import { Bloop } from "../src/bloop";
import { mount } from "../src/mount";

describe("rand", () => {
  describe("basic functionality", () => {
    it("generates deterministic sequence for same seed", async () => {
      const game = Bloop.create({ bag: { values: [] as number[] } });
      game.system("collect", {
        update({ bag, rand }) {
          bag.values.push(rand.next());
        },
      });

      const { sim } = await mount(game);

      // Set a known seed
      game.context.rand.seed(42);

      sim.step();
      sim.step();
      sim.step();

      const firstRun = [...game.bag.values];

      // Reset and use same seed
      game.bag.values = [];
      game.context.rand.seed(42);

      sim.step();
      sim.step();
      sim.step();

      expect(game.bag.values).toEqual(firstRun);
    });

    it("generates different sequences for different seeds", async () => {
      const game = Bloop.create({ bag: { values: [] as number[] } });
      game.system("collect", {
        update({ bag, rand }) {
          bag.values.push(rand.next());
        },
      });

      const { sim } = await mount(game);

      game.context.rand.seed(42);
      sim.step();
      sim.step();
      const firstRun = [...game.bag.values];

      game.bag.values = [];
      game.context.rand.seed(123);
      sim.step();
      sim.step();

      expect(game.bag.values).not.toEqual(firstRun);
    });

    it("next() returns values in [0, 1)", async () => {
      const game = Bloop.create({ bag: { values: [] as number[] } });
      game.system("collect", {
        update({ bag, rand }) {
          for (let i = 0; i < 100; i++) {
            bag.values.push(rand.next());
          }
        },
      });

      const { sim } = await mount(game);
      game.context.rand.seed(12345);
      sim.step();

      for (const val of game.bag.values) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });
  });

  describe("convenience methods", () => {
    it("coinFlip returns boolean", async () => {
      const game = Bloop.create({ bag: { results: [] as boolean[] } });
      game.system("flip", {
        update({ bag, rand }) {
          for (let i = 0; i < 50; i++) {
            bag.results.push(rand.coinFlip());
          }
        },
      });

      const { sim } = await mount(game);
      game.context.rand.seed(42);
      sim.step();

      // Should have some true and some false
      const trueCount = game.bag.results.filter((r) => r === true).length;
      const falseCount = game.bag.results.filter((r) => r === false).length;
      expect(trueCount).toBeGreaterThan(0);
      expect(falseCount).toBeGreaterThan(0);
      expect(trueCount + falseCount).toBe(50);
    });

    it("rollDice returns values in [1, sides]", async () => {
      const game = Bloop.create({ bag: { rolls: [] as number[] } });
      game.system("roll", {
        update({ bag, rand }) {
          for (let i = 0; i < 100; i++) {
            bag.rolls.push(rand.rollDice(6));
          }
        },
      });

      const { sim } = await mount(game);
      game.context.rand.seed(42);
      sim.step();

      for (const roll of game.bag.rolls) {
        expect(roll).toBeGreaterThanOrEqual(1);
        expect(roll).toBeLessThanOrEqual(6);
        expect(Number.isInteger(roll)).toBe(true);
      }

      // Should have variety (not all same value)
      const unique = new Set(game.bag.rolls);
      expect(unique.size).toBeGreaterThan(1);
    });

    it("int returns values in [min, max] inclusive", async () => {
      const game = Bloop.create({ bag: { values: [] as number[] } });
      game.system("generate", {
        update({ bag, rand }) {
          for (let i = 0; i < 100; i++) {
            bag.values.push(rand.int(5, 10));
          }
        },
      });

      const { sim } = await mount(game);
      game.context.rand.seed(42);
      sim.step();

      for (const val of game.bag.values) {
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(10);
        expect(Number.isInteger(val)).toBe(true);
      }
    });

    it("shuffle randomizes array in-place", async () => {
      const game = Bloop.create({ bag: { array: [1, 2, 3, 4, 5] } });
      game.system("shuffle", {
        update({ bag, rand }) {
          rand.shuffle(bag.array);
        },
      });

      const { sim } = await mount(game);
      const original = [1, 2, 3, 4, 5];
      game.context.rand.seed(42);
      sim.step();

      // Should contain same elements
      expect([...game.bag.array].sort()).toEqual(original);
      // Should be shuffled (very unlikely to be identical with seed 42)
      expect(game.bag.array).not.toEqual(original);
    });
  });

  describe("snapshot/restore", () => {
    it("preserves rand state across snapshot/restore", async () => {
      const game = Bloop.create({ bag: { values: [] as number[] } });
      game.system("collect", {
        update({ bag, rand }) {
          bag.values.push(rand.next());
        },
      });

      const { sim } = await mount(game);
      game.context.rand.seed(42);

      // Generate some values
      sim.step();
      sim.step();
      expect(game.bag.values.length).toBe(2);

      // Take snapshot
      const snapshot = sim.snapshot();

      // Generate more values
      sim.step();
      sim.step();
      const afterSnapshot = [...game.bag.values];
      expect(afterSnapshot.length).toBe(4);

      // Restore to snapshot
      sim.restore(snapshot);

      // Clear values collected after restore and continue
      game.bag.values = game.bag.values.slice(0, 2);

      // Generate more - should match what we got before
      sim.step();
      sim.step();

      expect(game.bag.values).toEqual(afterSnapshot);
    });
  });

  describe("tape replay", () => {
    it("produces identical results on tape replay", async () => {
      const game1 = Bloop.create({
        bag: { values: [] as number[], frame: 0 },
      });
      game1.system("collect", {
        update({ bag, rand, time }) {
          bag.values.push(rand.next());
          bag.frame = time.frame;
        },
      });

      // Mount without auto-recording so we can set seed first
      const { sim: sim1 } = await mount(game1, { startRecording: false });

      // Set seed before starting recording so the initial snapshot captures it
      game1.context.rand.seed(42);

      // Now start recording
      sim1.record();

      sim1.step();
      sim1.step();
      sim1.step();
      sim1.step();
      sim1.step();

      const originalValues = [...game1.bag.values];
      const tape = sim1.saveTape();

      // Create new game and load tape
      const game2 = Bloop.create({
        bag: { values: [] as number[], frame: 0 },
      });
      game2.system("collect", {
        update({ bag, rand, time }) {
          bag.values.push(rand.next());
          bag.frame = time.frame;
        },
      });

      const { sim: sim2 } = await mount(game2);
      sim2.loadTape(tape);

      // Seek to end - this should restore the snapshot which has seed 42
      sim2.seek(5);

      // Values should match
      expect(game2.bag.values).toEqual(originalValues);
    });
  });
});

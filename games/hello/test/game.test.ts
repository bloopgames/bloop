import { describe, expect, it } from "bun:test";
import { mount } from "@bloopjs/bloop";
import { moveSpeed } from "../src/config";
import { game } from "../src/game";

describe("game", () => {
  it("should initialize bag correctly", () => {
    expect(game.bag).toMatchObject({ x: 0, y: 0 });
  });

  it("should update bag correctly after system execution", async () => {
    const { sim } = await mount(game);

    sim.emit.keydown("KeyD");
    sim.emit.keydown("KeyW");
    sim.step();
    expect(game.bag).toMatchObject({ x: moveSpeed, y: moveSpeed });
  });
});

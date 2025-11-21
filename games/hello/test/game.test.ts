import { describe, expect, it } from "bun:test";
import { mount } from "@bloopjs/bloop";
import { game } from "../src/game";

describe("game", () => {
  it("should initialize bag correctly", () => {
    expect(game.bag).toEqual({ x: 0, y: 0 });
  });

  it("should update bag correctly after system execution", async () => {
    const { runtime } = await mount(game);

    runtime.emit.keydown("KeyD");
    runtime.emit.keydown("KeyW");
    runtime.step();
    expect(game.bag).toEqual({ x: 1, y: 1 });
  });
});

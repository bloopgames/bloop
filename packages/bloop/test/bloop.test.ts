import { describe, expect, it } from "bun:test";
import { Bloop, mount } from "../src/mod";

describe("runtime", () => {
  it("has valid context values before running first step", async () => {
    const bloop = Bloop.create({
      bag: { cool: 123 },
    });

    const { runtime } = await mount(bloop);

    expect(runtime.time.frame).toEqual(0);
    expect(runtime.time.dt).toEqual(0);
    expect(bloop.context.time.frame).toEqual(0);
    expect(bloop.context.time.dt).toEqual(0);
    expect(bloop.context.time.time).toEqual(0);

    expect(bloop.context.bag).toEqual({ cool: 123 });
    expect(bloop.context.inputs.mouse.x).toEqual(0);
    expect(bloop.context.inputs.mouse.y).toEqual(0);
  });
});

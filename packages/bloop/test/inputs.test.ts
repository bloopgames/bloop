import { it, expect, describe } from "bun:test";
import { mount, type Key, type MouseButton } from "@bloopjs/engine";
import { Bloop } from "../src/mod";

describe("loop", () => {
  it("runs a single system", async () => {
    const bloop = Bloop.create();
    let count = 0;

    bloop.system("test", {
      update() {
        count++;
      },
    });

    const { runtime } = await mount(bloop);
    runtime.step();

    expect(count).toEqual(1);
  });

  it("passes through input events", async () => {
    const bloop = Bloop.create();

    const events = {
      keydown: null as Key | null,
      keyup: null as Key | null,

      mousemove: null as { x: number; y: number } | null,
      mousedown: null as MouseButton | null,
      mouseup: null as MouseButton | null,
      mousewheel: null as { x: number; y: number } | null,
    };

    bloop.system("input", {
      keydown({ event }) {
        events.keydown = event.key;
      },
      keyup({ event }) {
        events.keyup = event.key;
      },
      mousemove({ event }) {
        events.mousemove = { x: event.x, y: event.y };
      },
      mousedown({ event }) {
        events.mousedown = event.button;
      },
      mouseup({ event }) {
        events.mouseup = event.button;
      },
      mousewheel({ event }) {
        events.mousewheel = event;
      },
    });

    const { runtime, emitter } = await mount(bloop);

    emitter.keydown("Space");
    emitter.mousemove(100, 150);
    emitter.mousedown("Left");
    emitter.mousewheel(1, 2);

    runtime.step();

    expect(events.keydown).toEqual("Space");
    expect(events.mousemove).toEqual({ x: 100, y: 150 });
    expect(events.mousedown).toEqual("Left");
    expect(events.mousewheel).toEqual({ x: 1, y: 2 });

    emitter.keyup("Space");
    emitter.mouseup("Left");
    emitter.mousemove(3, 4);

    runtime.step();

    expect(events.keyup).toEqual("Space");
    expect(events.mouseup).toEqual("Left");
    expect(events.mousemove).toEqual({ x: 3, y: 4 });
  });

  it("keeps track of keyboard and mouse snapshots", async () => {
    const bloop = Bloop.create({
      bag: {
        cool: "nice",
      },
    });

    const events = {
      keydown: null as boolean | null,
      keyheld: null as boolean | null,
      keyup: null as boolean | null,
      mouseheld: null as boolean | null,
      mousedown: null as boolean | null,
      mouseup: null as boolean | null,
    };

    bloop.system("input snapshots", {
      update({ inputs }) {
        events.keydown = inputs.keys.space.down;
        events.keyheld = inputs.keys.space.held;
        events.keyup = inputs.keys.space.up;

        events.mousedown = inputs.mouse.left.down;
        events.mouseheld = inputs.mouse.left.held;
        events.mouseup = inputs.mouse.left.up;
      },
    });

    const { runtime, emitter } = await mount(bloop);

    // Initial state
    runtime.step();
    expect(events).toEqual({
      keydown: false,
      keyheld: false,
      keyup: false,
      mousedown: false,
      mouseheld: false,
      mouseup: false,
    });

    // down and held are both true on the first frame of a key down
    emitter.keydown("Space");
    emitter.mousedown("Left");
    runtime.step();
    expect(events).toEqual({
      keydown: true,
      keyheld: true,
      keyup: false,
      mousedown: true,
      mouseheld: true,
      mouseup: false,
    });

    // held remains true, down goes false
    runtime.step();
    expect(events).toEqual({
      keydown: false,
      keyheld: true,
      keyup: false,
      mousedown: false,
      mouseheld: true,
      mouseup: false,
    });

    // on key up, up is true, held and down are false
    emitter.keyup("Space");
    emitter.mouseup("Left");
    runtime.step();
    expect(events).toEqual({
      keydown: false,
      keyheld: false,
      keyup: true,
      mousedown: false,
      mouseheld: false,
      mouseup: true,
    });
  });

  it.skip("handles multiple frames between accumulated inputs", async () => {});
  it.skip("handles down and up between frames", async () => {});
});

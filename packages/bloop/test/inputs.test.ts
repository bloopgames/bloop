import { it, expect, describe } from "bun:test";
import { mount, type Key, type MouseButton } from "@bloopjs/engine";
import { Bloop } from "../src/mod";

describe("loop", () => {
  it("runs a single system", async () => {
    const bloop = Bloop();
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
    const bloop = Bloop();

    const events = {
      keydown: null as Key | null,
      keyup: null as Key | null,
      keyheld: null as Key | null,

      mousemove: null as { x: number; y: number } | null,
      mousedown: null as MouseButton | null,
      mouseheld: null as MouseButton | null,
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
      keyheld({ event }) {
        events.keyheld = event.key;
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

  it.skip("keeps track of keyboard and mouse snapshots", async () => {});

  it.skip('synthesizes "keyheld" and "mouseheld" events', async () => {});
});

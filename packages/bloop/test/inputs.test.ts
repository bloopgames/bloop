import { describe, expect, it } from "bun:test";
import type { Key, MouseButton } from "@bloopjs/engine";
import { Bloop, mount } from "../src/mod";

describe("inputs", () => {
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

  it("routes keydown event", async () => {
    const bloop = Bloop.create();
    let receivedKey: Key | null = null;
    let called = false;
    bloop.system("input", {
      keydown({ event }) {
        receivedKey = event.key;
        called = true;
      },
    });

    const { runtime } = await mount(bloop);
    runtime.emit.keydown("Space");
    runtime.step();

    expect(called).toBe(true);
    expect(receivedKey!).toEqual("Space");
  });

  it("routes all input events", async () => {
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

    const { runtime } = await mount(bloop);

    runtime.emit.keydown("Space");
    runtime.emit.mousedown("Left");
    runtime.emit.mousemove(100, 150);
    runtime.emit.mousewheel(1, 2);

    runtime.step();

    expect(events.keydown).toEqual("Space");
    expect(events.mousemove).toEqual({ x: 100, y: 150 });
    expect(events.mousedown).toEqual("Left");
    expect(events.mousewheel).toEqual({ x: 1, y: 2 });

    runtime.emit.keyup("Space");
    runtime.emit.mouseup("Left");
    runtime.emit.mousemove(3, 4);

    runtime.step();

    expect(events.keyup).toEqual("Space");
    expect(events.mouseup).toEqual("Left");
    expect(events.mousemove).toEqual({ x: 3, y: 4 });
  });

  it("exposes keyboard context", async () => {
    const bloop = Bloop.create({
      bag: {
        down: null as boolean | null,
        held: null as boolean | null,
        up: null as boolean | null,
      },
    });

    bloop.system("key state", {
      update({ inputs, bag }) {
        bag.down = inputs.keys.backquote.down;
        bag.held = inputs.keys.backquote.held;
        bag.up = inputs.keys.backquote.up;
      },
    });

    const { runtime } = await mount(bloop);

    // Initial state
    runtime.step();
    expect(bloop.bag).toEqual({
      down: false,
      held: false,
      up: false,
    });

    // down and held are both true on the first frame of a key down
    runtime.emit.keydown("Backquote");
    runtime.step();
    expect(bloop.bag).toEqual({
      down: true,
      held: true,
      up: false,
    });

    // held remains true, down goes false
    runtime.step();
    expect(bloop.bag).toEqual({
      down: false,
      held: true,
      up: false,
    });

    // on key up, up is true, held and down are false
    runtime.emit.keyup("Backquote");
    runtime.step();
    expect(bloop.bag).toEqual({
      down: false,
      held: false,
      up: true,
    });
  });

  it("exposes mouse context", async () => {
    const bloop = Bloop.create({
      bag: {
        down: null as boolean | null,
        held: null as boolean | null,
        up: null as boolean | null,
        position: null as { x: number; y: number } | null,
        wheel: null as { x: number; y: number } | null,
      },
    });

    bloop.system("mouse state", {
      update({ inputs, bag }) {
        bag.down = inputs.mouse.left.down;
        bag.held = inputs.mouse.left.held;
        bag.up = inputs.mouse.left.up;
        bag.position = { x: inputs.mouse.x, y: inputs.mouse.y };
        bag.wheel = inputs.mouse.wheel;
      },
    });

    const { runtime } = await mount(bloop);

    // Initial state
    runtime.step();
    expect(bloop.bag).toEqual({
      down: false,
      held: false,
      up: false,
      position: { x: 0, y: 0 },
      wheel: { x: 0, y: 0 },
    });

    // down and held are both true on the first frame of a key down
    runtime.emit.mousedown("Left");
    runtime.step();
    expect(bloop.bag).toMatchObject({
      down: true,
      held: true,
      up: false,
    });

    runtime.emit.mousemove(123, 456);
    runtime.step();
    expect(bloop.bag).toMatchObject({
      down: false,
      held: true,
      up: false,
      position: { x: 123, y: 456 },
    });

    runtime.emit.mousewheel(5, -3);
    runtime.step();
    expect(bloop.bag).toMatchObject({
      down: false,
      held: true,
      up: false,
      position: { x: 123, y: 456 },
      wheel: { x: 5, y: -3 },
    });

    runtime.emit.mouseup("Left");
    runtime.step();
    expect(bloop.bag).toMatchObject({
      down: false,
      held: false,
      up: true,
    });
  });

  it.skip("handles multiple frames between accumulated inputs", async () => {});
  it.skip("handles down and up between frames", async () => {});
});

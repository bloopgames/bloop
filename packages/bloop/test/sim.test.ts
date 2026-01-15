import { describe, expect, it } from "bun:test";
import {
  KeyboardContext,
  type KeyState,
  MOUSE_OFFSET,
  MouseContext,
} from "@bloopjs/engine";
import { Bloop } from "../src/bloop";
import { mount } from "../src/mount";
import type { EngineHooks } from "../src/sim";

const defaultHooks: EngineHooks = {
  serialize: () => ({
    size: 0,
    write() {},
  }),
  deserialize() {},
  systemsCallback() {},
  setBuffer() {},
  setContext() {},
};

it("hello wasm", async () => {
  let count = 0;
  const { sim } = await mount({
    hooks: {
      ...defaultHooks,
      systemsCallback() {
        count++;
      },
    },
  });

  sim.wasm.step(16);
  expect(count).toBe(1);
});

describe("time", () => {
  it("injects frame and dt", async () => {
    const { sim } = await mount({ hooks: defaultHooks });

    sim.step(16);
    expect(sim.time.frame).toEqual(1);
    expect(sim.time.dt).toEqual(0.016);
  });

  it("exposes time context pointer in system callback", async () => {
    let called = false;
    const { sim } = await mount({
      hooks: {
        ...defaultHooks,
        systemsCallback(_handle, ptr) {
          called = true;
          const dataView = new DataView(sim.buffer, ptr);
          const timeCtxPtr = dataView.getUint32(0, true);
          const timeDataView = new DataView(sim.buffer, timeCtxPtr);
          const frame = timeDataView.getUint32(0, true);
          const dt = timeDataView.getUint32(4, true);
          expect(frame).toEqual(0);
          expect(dt).toEqual(16);
        },
      },
    });
    sim.step(16);

    expect(called).toEqual(true);
  });
});

describe("snapshots", () => {
  it("can capture time to a snapshot", async () => {
    const { sim } = await mount({ hooks: defaultHooks });

    sim.step(16);
    sim.step(16);
    expect(sim.time.frame).toEqual(2);
    expect(sim.time.dt).toEqual(0.016);

    const snapshot = sim.snapshot();

    sim.step(16);
    expect(sim.time.frame).toEqual(3);

    sim.restore(snapshot);
    expect(sim.time.frame).toEqual(2);

    sim.step(16);
    expect(sim.time.frame).toEqual(3);
  });
});

describe("inputs", () => {
  it("updates input context in response to keyboard events", async () => {
    let called = false;
    const states: KeyState[] = [];

    const { sim } = await mount({
      hooks: {
        ...defaultHooks,
        systemsCallback(_handle, ptr) {
          const dataView = new DataView(sim.buffer, ptr);
          const inputCtxPtr = dataView.getUint32(4, true);
          const inputDataView = new DataView(sim.buffer, inputCtxPtr);

          const keyboardContext = new KeyboardContext(inputDataView);
          states.push(keyboardContext.digit8);

          called = true;
        },
      },
    });

    sim.emit.keydown("Digit8");
    sim.step();
    sim.step();
    sim.emit.keyup("Digit8");
    sim.step();
    expect(called).toEqual(true);

    expect(states[0]).toEqual({
      down: true,
      held: true,
      up: false,
    });

    expect(states[1]).toEqual({
      down: false,
      held: true,
      up: false,
    });

    expect(states[2]).toEqual({
      down: false,
      held: false,
      up: true,
    });
  });

  it("updates input context in response to mouse events", async () => {
    let called = false;
    type MouseState = {
      x: number;
      y: number;
      wheelX: number;
      wheelY: number;
      left: KeyState;
    };
    const states: MouseState[] = [];

    const { sim } = await mount({
      hooks: {
        ...defaultHooks,
        systemsCallback(_handle, ptr) {
          const dataView = new DataView(sim.buffer, ptr);
          const inputCtxPtr = dataView.getUint32(4, true);
          const inputDataView = new DataView(sim.buffer, inputCtxPtr);

          const dv = new DataView(
            inputDataView.buffer,
            inputDataView.byteOffset + MOUSE_OFFSET,
          );
          const mouseContext = new MouseContext(dv);

          states.push({
            x: mouseContext.x,
            y: mouseContext.y,
            left: mouseContext.left,
            wheelX: mouseContext.wheelX,
            wheelY: mouseContext.wheelY,
          });

          called = true;
        },
      },
    });

    sim.emit.mousedown("Left");
    sim.step();

    sim.emit.mousemove(123, 456);
    sim.emit.mousewheel(789, 101);
    sim.step();

    sim.emit.mouseup("Left");
    sim.step();

    expect(called).toEqual(true);

    expect(states[0]).toMatchObject({
      left: {
        down: true,
        held: true,
        up: false,
      },
    });

    expect(states[1]).toMatchObject({
      left: {
        down: false,
        held: true,
        up: false,
      },
      x: 123,
      y: 456,
      wheelX: 789,
      wheelY: 101,
    });

    expect(states[2]).toMatchObject({
      left: {
        down: false,
        held: false,
        up: true,
      },
    });
  });

  it("updates platform events with input events", async () => {
    let called = false;
    const { sim } = await mount({
      hooks: {
        ...defaultHooks,
        systemsCallback(_handle, ptr) {
          const dataView = new DataView(sim.buffer, ptr);
          const eventsPtr = dataView.getUint32(8, true);
          const eventsDataView = new DataView(sim.buffer, eventsPtr);
          const eventCount = eventsDataView.getUint32(0, true);
          expect(eventCount).toEqual(1);
          // kind = 1 byte + 3 bytes padding
          // payload = 8 bytes
          const typeOffset = 4;
          const payloadOffset = 7;
          const eventType = eventsDataView.getUint8(typeOffset + 0);
          const eventPayload = eventsDataView.getUint8(payloadOffset + 1);
          expect(eventCount).toEqual(1);
          expect(eventType).toEqual(1);
          expect(eventPayload).toEqual(3); // KeyCode for BracketLeft
          called = true;
        },
      },
    });

    sim.emit.keydown("BracketLeft");
    sim.step();
    expect(called).toEqual(true);
  });
});

describe("tapes", () => {
  describe("engine snapshot", () => {
    it("saves and restores time context", async () => {
      const { sim } = await mount({ hooks: defaultHooks });

      const snapshot = sim.snapshot();
      expect(sim.time.frame).toEqual(0);
      sim.step();
      expect(sim.time.frame).toEqual(1);
      sim.step();
      expect(sim.time.frame).toEqual(2);
      sim.restore(snapshot);

      expect(sim.time.frame).toEqual(0);
    });
  });

  describe("caller payload", () => {
    it("can capture and restore arbitrary payloads", async () => {
      let called = false;
      const { sim } = await mount(
        {
          hooks: {
            ...defaultHooks,
            serialize() {
              return {
                write(buffer, ptr) {
                  const data = new Uint8Array(buffer, ptr, 1);
                  data[0] = 66;
                },
                size: 1,
              };
            },
            deserialize(buffer, ptr, length) {
              called = true;
              const data = new Uint8Array(buffer, ptr, length);
              expect(data.byteLength).toBe(1);
              expect(length).toEqual(1);
              expect(data[0]).toBe(66);
            },
          },
        },
        { startRecording: false },
      );

      const snapshot = sim.snapshot();
      sim.restore(snapshot);
      expect(called).toEqual(true);
    });
  });
});

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

  it("cloneSession allows inputs after HMR", async () => {
    // Simulates the HMR flow in acceptHmr:
    // 1. Original sim is recording (web start() defaults to startRecording: true)
    // 2. New sim is mounted
    // 3. cloneSession transfers tape and snapshot
    // 4. On first step, engine auto-exits replay mode and accepts new inputs

    const game = Bloop.create({
      bag: { x: 0, y: 0 },
    });
    game.system("track", {
      update({ bag, inputs }) {
        bag.x = inputs.mouse.x;
        bag.y = inputs.mouse.y;
      },
    });

    // Mount with recording (like web start() does)
    const { sim } = await mount(game, { startRecording: true });

    sim.emit.mousemove(10, 20);
    sim.step();
    expect(game.bag).toEqual({ x: 10, y: 20 });
    expect(sim.isRecording).toBe(true);

    // Create a new game (like HMR does)
    const game1 = Bloop.create({
      bag: { x: 0, y: 0 },
    });
    game1.system("track", {
      update({ bag, inputs }) {
        bag.x = inputs.mouse.x;
        bag.y = inputs.mouse.y;
      },
    });

    // Mount new sim (like acceptHmr does)
    const { sim: sim1 } = await mount(game1, { startRecording: true });

    // Clone session (like acceptHmr does)
    sim1.cloneSession(sim);

    // State should be preserved
    expect(game1.bag).toEqual({ x: 10, y: 20 });

    // New inputs should work - engine auto-exits replay mode on step()
    // when it detects we've passed the tape end
    sim1.emit.mousemove(30, 40);
    sim1.step();
    expect(sim1.isReplaying).toBe(false); // Now exited replay mode
    expect(game1.bag).toEqual({ x: 30, y: 40 });
  });

  it("cloneSession preserves paused state from HMR", async () => {
    // Reproduces the HMR flow in acceptHmr:
    // 1. Original sim is running, then user pauses it
    // 2. HMR triggers - acceptHmr pauses old sim (already paused)
    // 3. New sim is mounted
    // 4. cloneSession transfers tape and snapshot
    // 5. New sim should remain paused (bug: it wasn't)

    const game = Bloop.create({
      bag: { x: 0, y: 0 },
    });
    game.system("track", {
      update({ bag, inputs }) {
        bag.x = inputs.mouse.x;
        bag.y = inputs.mouse.y;
      },
    });

    // Mount with recording (like web start() does)
    const { sim } = await mount(game, { startRecording: true });

    sim.emit.mousemove(10, 20);
    sim.step();
    expect(game.bag).toEqual({ x: 10, y: 20 });

    // User pauses the game (e.g., via debug UI or hotkey)
    sim.pause();
    expect(sim.isPaused).toBe(true);

    // HMR happens - create new game (like acceptHmr does)
    const game1 = Bloop.create({
      bag: { x: 0, y: 0 },
    });
    game1.system("track", {
      update({ bag, inputs }) {
        bag.x = inputs.mouse.x;
        bag.y = inputs.mouse.y;
      },
    });

    // Mount new sim (like acceptHmr does)
    const { sim: sim1 } = await mount(game1, { startRecording: true });

    // Clone session (like acceptHmr does)
    sim1.cloneSession(sim);

    // State should be preserved
    expect(game1.bag).toEqual({ x: 10, y: 20 });

    // BUG: The new sim should also be paused since the old sim was paused
    expect(sim1.isPaused).toBe(true);
  });

  it("regression: accepts live inputs after dumping", async () => {
    const game = Bloop.create({
      bag: {
        x: 0,
        y: 0,
      },
    });
    game.system("hello", {
      update({ bag, inputs }) {
        bag.x = inputs.mouse.x;
        bag.y = inputs.mouse.y;
      },
    });
    const { sim } = await mount(game);
    sim.emit.mousemove(10, 20);
    sim.step();
    expect(game.bag).toEqual({ x: 10, y: 20 });

    const game1 = Bloop.create({
      bag: {
        x: 0,
        y: 0,
      },
    });
    game1.system("hello", {
      update({ bag, inputs }) {
        bag.x = inputs.mouse.x;
        bag.y = inputs.mouse.y;
      },
    });

    const { sim: sim1 } = await mount(game1);
    sim1.cloneSession(sim);
    expect(game1.bag).toEqual({ x: 10, y: 20 });
    sim1.emit.mousemove(30, 40);
    sim1.step();
    expect(game1.bag).toEqual({ x: 30, y: 40 });
  });
});

function toHexString(bytes: DataView | Uint8Array, length?: number): string {
  const dv =
    bytes instanceof DataView
      ? bytes
      : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  length ??= dv.byteLength;

  let hexString = "";
  for (let i = 0; i < length; i++) {
    const byte = dv.getUint8(i);
    hexString += `${byte.toString(16).padStart(2, "0")} `;
  }
  return hexString.trim();
}

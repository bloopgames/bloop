import { describe, expect, it } from "bun:test";
import {
  KeyboardContext,
  type KeyState,
  MOUSE_OFFSET,
  MouseContext,
} from "@bloopjs/engine";
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
    const { sim } = await mount({
      hooks: defaultHooks,
    });

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
    const { sim } = await mount({
      hooks: defaultHooks,
    });

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
      const { sim } = await mount({
        hooks: defaultHooks,
      });

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
      const { sim } = await mount({
        startRecording: false,
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
      });

      const snapshot = sim.snapshot();
      sim.restore(snapshot);
      expect(called).toEqual(true);
    });
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

import { describe, expect, it } from "bun:test";
import {
  KeyboardContext,
  type KeyState,
  MOUSE_OFFSET,
  MouseContext,
} from "@bloopjs/engine";
import { mount } from "../src/mount";
import { type EngineHooks } from "../src/runtime";
import { assert } from "../src/util";

const defaultHooks: EngineHooks = {
  serialize: () => ({
    size: 0,
    write() {},
  }),
  deserialize() {},
  systemsCallback() {},
  setBuffer() {},
};

it("hello wasm", async () => {
  let count = 0;
  const { wasm } = await mount({
    hooks: {
      ...defaultHooks,
      systemsCallback() {
        count++;
      },
    },
  });

  wasm.step(16);
  expect(count).toBe(1);
});

describe("time", () => {
  it("injects frame and dt", async () => {
    const { runtime } = await mount({
      hooks: defaultHooks,
    });

    runtime.step(16);
    expect(runtime.time.frame).toEqual(1);
    expect(runtime.time.dt).toEqual(0.016);
  });

  it("exposes time context pointer in system callback", async () => {
    let called = false;
    const { runtime } = await mount({
      hooks: {
        ...defaultHooks,
        systemsCallback(_handle, ptr) {
          called = true;
          const dataView = new DataView(runtime.buffer, ptr);
          const timeCtxPtr = dataView.getUint32(0, true);
          const timeDataView = new DataView(runtime.buffer, timeCtxPtr);
          const frame = timeDataView.getUint32(0, true);
          const dt = timeDataView.getUint32(4, true);
          expect(frame).toEqual(0);
          expect(dt).toEqual(16);
        },
      },
    });
    runtime.step(16);

    expect(called).toEqual(true);
  });
});

describe("snapshots", () => {
  it("can capture time to a snapshot", async () => {
    const { runtime } = await mount({
      hooks: defaultHooks,
    });

    runtime.step(16);
    runtime.step(16);
    expect(runtime.time.frame).toEqual(2);
    expect(runtime.time.dt).toEqual(0.016);

    const snapshot = runtime.snapshot();

    runtime.step(16);
    expect(runtime.time.frame).toEqual(3);

    runtime.restore(snapshot);
    expect(runtime.time.frame).toEqual(2);

    runtime.step(16);
    expect(runtime.time.frame).toEqual(3);
  });
});

describe("inputs", () => {
  it("updates input context in response to keyboard events", async () => {
    let called = false;
    const states: KeyState[] = [];

    const { runtime } = await mount({
      hooks: {
        ...defaultHooks,
        systemsCallback(_handle, ptr) {
          const dataView = new DataView(runtime.buffer, ptr);
          const inputCtxPtr = dataView.getUint32(4, true);
          const inputDataView = new DataView(runtime.buffer, inputCtxPtr);

          const keyboardContext = new KeyboardContext(inputDataView);
          states.push(keyboardContext.digit8);

          called = true;
        },
      },
    });

    runtime.emit.keydown("Digit8");
    runtime.step();
    runtime.step();
    runtime.emit.keyup("Digit8");
    runtime.step();
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

    const { runtime } = await mount({
      hooks: {
        ...defaultHooks,

        systemsCallback(_handle, ptr) {
          const dataView = new DataView(runtime.buffer, ptr);
          const inputCtxPtr = dataView.getUint32(4, true);
          const inputDataView = new DataView(runtime.buffer, inputCtxPtr);

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

    runtime.emit.mousedown("Left");
    runtime.step();

    runtime.emit.mousemove(123, 456);
    runtime.emit.mousewheel(789, 101);
    runtime.step();

    runtime.emit.mouseup("Left");
    runtime.step();

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
    const { runtime } = await mount({
      hooks: {
        ...defaultHooks,
        systemsCallback(_handle, ptr) {
          const dataView = new DataView(runtime.buffer, ptr);
          const eventsPtr = dataView.getUint32(8, true);
          const eventsDataView = new DataView(runtime.buffer, eventsPtr);
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

    runtime.emit.keydown("BracketLeft");
    runtime.step();
    expect(called).toEqual(true);
  });
});

describe("tapes", () => {
  describe("engine snapshot", () => {
    it("saves and restores time context", async () => {
      const { runtime } = await mount({
        hooks: defaultHooks,
      });

      const snapshot = runtime.snapshot();
      expect(runtime.time.frame).toEqual(0);
      runtime.step();
      expect(runtime.time.frame).toEqual(1);
      runtime.step();
      expect(runtime.time.frame).toEqual(2);
      runtime.restore(snapshot);

      expect(runtime.time.frame).toEqual(0);
    });
  });

  describe("caller payload", () => {
    it("can capture and restore arbitrary payloads", async () => {
      let called = false;
      const { runtime } = await mount({
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

      const snapshot = runtime.snapshot();
      runtime.restore(snapshot);
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

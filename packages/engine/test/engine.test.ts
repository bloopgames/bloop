import { it, expect, describe } from "bun:test";
import { mount } from "../js/engine";

it("hello wasm", async () => {
  let count = 0;
  const { wasm } = await mount({
    systemsCallback() {
      count++;
    },
    setBuffer() {},
  });

  wasm.step(16);
  expect(count).toBe(1);
});

describe("time", () => {
  it("injects frame and dt", async () => {
    const { runtime } = await mount({
      systemsCallback() {},
      setBuffer() {},
    });

    runtime.step(16);
    expect(runtime.time.frame).toEqual(1);
    expect(runtime.time.dt).toEqual(0.016);
  });

  it("exposes time context pointer in system callback", async () => {
    let called = false;
    const { runtime } = await mount({
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
      setBuffer() {},
    });
    runtime.step(16);

    expect(called).toEqual(true);
  });
});

describe("snapshots", () => {
  it("can capture time to a snapshot", async () => {
    const { runtime } = await mount({
      systemsCallback() {},
      setBuffer() {},
    });

    runtime.record();
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

describe("input events", () => {
  it("updates input context in response to input events", async () => {
    let called = false;
    const { runtime } = await mount({
      systemsCallback(_handle, ptr) {
        const dataView = new DataView(runtime.buffer, ptr);
        const inputCtxPtr = dataView.getUint32(4, true);
        const inputDataView = new DataView(runtime.buffer, inputCtxPtr);
        const keystate = inputDataView.getUint8(1);
        expect(keystate).toEqual(0b00000001);
        called = true;
      },
      setBuffer() {},
    });

    runtime.emit.keydown("Backquote");
    runtime.step();
    expect(called).toEqual(true);
  });

  it("updates platform events with input events", async () => {
    let called = false;
    const { runtime } = await mount({
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
      setBuffer() {},
    });

    runtime.emit.keydown("BracketLeft");
    runtime.step();
    expect(called).toEqual(true);
  });
});

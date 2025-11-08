import { it, expect, describe } from "bun:test";
import { mount } from "../js/engine";

it("hello wasm", async () => {
  let count = 0;
  const { wasm } = await mount({
    systemsCallback(handle, ptr) {
      count++;
    },
  });

  wasm.step(16);
  expect(count).toBe(1);
});

describe("time", () => {
  it("injects frame and dt", async () => {
    const { runtime } = await mount({
      systemsCallback(handle, ptr) {},
    });

    runtime.step(16);
    expect(runtime.time.frame).toEqual(1);
    expect(runtime.time.dt).toEqual(0.016);
  });

  it("exposes time context pointer in system callback", async () => {
    let called = false;
    const { runtime } = await mount({
      systemsCallback(handle, ptr) {
        called = true;
        const dataView = new DataView(runtime.buffer, ptr);
        const timeCtxPtr = dataView.getUint32(0, true);
        const timeDataView = new DataView(runtime.buffer, timeCtxPtr);
        const frame = timeDataView.getUint32(0, true);
        const dt = timeDataView.getUint32(4, true);
        expect(frame).toEqual(0);
        expect(dt).toEqual(16);
      },
    });
    runtime.step(16);

    expect(called).toEqual(true);
  });
});

describe("platform events", () => {
  it("allows caller to emit platform events between frames", async () => {
    const { runtime } = await mount({
      systemsCallback(handle, ptr) {},
    });
  });
});

describe("snapshots", () => {
  it("can capture time to a snapshot", async () => {
    const { runtime } = await mount({
      systemsCallback(handle, ptr) {},
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

import { it, expect, describe } from "bun:test";
import { mount } from "../js/engine";

it("hello wasm", async () => {
  let count = 0;
  const { wasm } = await mount({
    systemsCallback(ptr: number) {
      count++;
    },
    snapshot() {
      return new Uint8Array();
    },
    restore(_snapshot: Uint8Array) {},
  });

  wasm.step(16);
  expect(count).toBe(1);
});

describe("time context", () => {
  it("marches frame", async () => {
    const { runtime } = await mount({
      systemsCallback(ptr: number) {},
      snapshot() {
        return new Uint8Array();
      },
      restore(_snapshot: Uint8Array) {},
    });

    runtime.step(16);

    const bufferPtr = runtime.wasm.time_ctx();
    const dataView = new DataView(runtime.buffer, bufferPtr);
    expect(dataView.getUint32(0, true)).toEqual(1);
  });
});

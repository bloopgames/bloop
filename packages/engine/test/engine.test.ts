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

describe("time", () => {
  it("injects frame and dt", async () => {
    const { runtime } = await mount({
      systemsCallback(ptr: number) {},
      snapshot() {
        return new Uint8Array();
      },
      restore(_snapshot: Uint8Array) {},
    });

    runtime.step(16);
    expect(runtime.time.frame).toEqual(1);
    expect(runtime.time.dt).toEqual(0.016);
  });
});

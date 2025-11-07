import { it, expect } from "bun:test";
import { mount } from "../js/mod";

it("hello wasm", async () => {
  let count = 0;
  const wasm = await mount((ret) => {
    count++
  });
  wasm.register_systems(0);
  wasm.step(16);
  expect(count).toBe(1);
});
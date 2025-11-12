export * as Enums from "./codegen/enums";
export * from "./contexts/inputContext";
export * from "./contexts/timeContext";
export * from "./inputs";
export type * from "./wasmEngine";

export type EnginePointer = number;
export type EngineLen = number;

export const DEFAULT_WASM_URL = new URL("../wasm/bloop.wasm", import.meta.url);

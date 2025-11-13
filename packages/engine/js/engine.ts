export * as Enums from "./codegen/enums";
export * from "./contexts/inputContext";
export * from "./contexts/timeContext";
export * from "./inputs";
export type * from "./wasmEngine";

export type EnginePointer = number;
export type EngineLen = number;

export const DEFAULT_WASM_URL = new URL("../wasm/bloop.wasm", import.meta.url);

export const TIME_CTX_OFFSET = 0;
export const INPUT_CTX_OFFSET = TIME_CTX_OFFSET + 4;
export const EVENTS_OFFSET = INPUT_CTX_OFFSET + 4;

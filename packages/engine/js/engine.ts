export * as Enums from "./codegen/enums";
export * from "./contexts/inputContext";
export * from "./contexts/netContext";
export * from "./contexts/timeContext";
export * from "./inputs";
export * from "./tape";
export * from "./net-events";
export * from "./net-wants";
export type * from "./wasmEngine";

/**
 * A pointer to shared wasm memory space. Use it like
 *
 * const dataView = new DataView(wasmMemory.buffer, ptr);
 */
export type EnginePointer = number;
export type EngineLen = number;
/**
 * A return value indicating success.
 *
 * 0 = success
 * 1 = failure
 * other values are function specific error codes
 */
export type EngineOk = number;

export { DEFAULT_WASM_URL } from "./defaultUrl";

export const MAX_ROLLBACK_FRAMES = 500;

export const TIME_CTX_OFFSET = 0;
export const INPUT_CTX_OFFSET = TIME_CTX_OFFSET + 4;
export const EVENTS_OFFSET = INPUT_CTX_OFFSET + 4;
export const NET_CTX_OFFSET = EVENTS_OFFSET + 4;

/**
 * Size of snapshot header in bytes
 */
export const SNAPSHOT_HEADER_LEN = 16;
export const SNAPSHOT_HEADER_USER_LEN_OFFSET = 4;
export const SNAPSHOT_HEADER_ENGINE_LEN_OFFSET = 8;

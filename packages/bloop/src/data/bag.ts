/**
 * A bag of serializable values that can be recorded to a snapshot
 */
export interface Bag {
  [key: string]: BagValue;
}

export type BagValue =
  | string
  | number
  | boolean
  | BagValue[]
  | Bag
  | Uint8Array
  | null;

/**
 * Recursively widens boolean literal types to `boolean`.
 * - `true` / `false` → `boolean`
 * - Objects and arrays are recursively widened
 * - Numbers, strings, `null`, and `Uint8Array` are preserved as-is
 *
 * Note: We intentionally do NOT widen number or string literals because
 * users often want to preserve intentional union types like `1 | -1` or
 * `"idle" | "playing"`.
 */
export type Widen<T> = T extends boolean
  ? boolean
  : T extends readonly (infer U)[]
    ? Widen<U>[]
    : T extends Uint8Array
      ? Uint8Array
      : T extends object
        ? { [K in keyof T]: Widen<T[K]> }
        : T;

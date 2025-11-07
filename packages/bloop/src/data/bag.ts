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

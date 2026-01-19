import { RAND_CTX_SEED_OFFSET } from "../codegen/offsets";

/**
 * Deterministic random number generator context.
 *
 * Uses the mulberry32 algorithm, a fast 32-bit PRNG with good statistical properties.
 * The seed state is stored in engine memory and snapshotted for tape replay.
 */
export class RandContext {
  dataView?: DataView;

  constructor(dataView?: DataView) {
    this.dataView = dataView;
  }

  /**
   * Set the random seed.
   * Call this to reset the PRNG sequence.
   */
  seed(value: number): void {
    if (!this.dataView) {
      throw new Error("RandContext not initialized");
    }
    // Ensure value is a 32-bit unsigned integer
    this.dataView.setUint32(RAND_CTX_SEED_OFFSET, value >>> 0, true);
  }

  /**
   * Get the current seed value (for debugging/testing).
   */
  getSeed(): number {
    if (!this.dataView) {
      throw new Error("RandContext not initialized");
    }
    return this.dataView.getUint32(RAND_CTX_SEED_OFFSET, true);
  }

  /**
   * Generate the next pseudorandom number in [0, 1) using mulberry32.
   *
   * The algorithm advances the internal seed state and returns a value
   * that is deterministic given the same seed sequence.
   */
  next(): number {
    if (!this.dataView) {
      throw new Error("RandContext not initialized");
    }

    // Read current seed
    let seed = this.dataView.getUint32(RAND_CTX_SEED_OFFSET, true);

    // Mulberry32 algorithm
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    // Write updated seed back
    this.dataView.setUint32(RAND_CTX_SEED_OFFSET, seed >>> 0, true);

    // Return normalized value in [0, 1)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns true with 50% probability.
   */
  coinFlip(): boolean {
    return this.next() < 0.5;
  }

  /**
   * Roll a dice with the specified number of sides.
   * @param sides Number of sides on the dice (default: 6)
   * @returns A random integer from 1 to sides (inclusive)
   */
  rollDice(sides = 6): number {
    return Math.floor(this.next() * sides) + 1;
  }

  /**
   * Generate a random integer in the range [min, max] (inclusive).
   */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Generate a random float in the range [min, max] (inclusive).
   */
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /**
   * Shuffle an array in-place using the Fisher-Yates algorithm.
   * @returns The same array, shuffled
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const temp = array[i]!;
      array[i] = array[j]!;
      array[j] = temp;
    }
    return array;
  }
}

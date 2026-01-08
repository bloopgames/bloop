import type {
  InputContext,
  PlayerInputContext,
  NetContext,
} from "@bloopjs/engine";

/**
 * Collection of player input contexts with ergonomic access.
 *
 * - `.get(i)` returns PlayerInputContext without undefined (throws for out-of-bounds 0-11)
 * - Iteration yields only connected players
 * - `.count` returns number of connected players
 */
export class Players implements Iterable<PlayerInputContext> {
  readonly #inputs: InputContext;
  readonly #net: NetContext;

  constructor(inputs: InputContext, net: NetContext) {
    this.#inputs = inputs;
    this.#net = net;
  }

  /**
   * Get player input context by index.
   * @param index Player index (0-11)
   * @returns PlayerInputContext for that slot
   * @throws RangeError if index out of bounds
   */
  get(index: number): PlayerInputContext {
    const players = this.#inputs.players;
    if (index < 0 || index >= players.length) {
      throw new RangeError(
        `Player index ${index} out of bounds (0-${players.length - 1})`,
      );
    }
    return players[index]!;
  }

  /** Number of connected players (1 in local mode, peerCount in multiplayer) */
  get count(): number {
    return this.#net.isInSession ? this.#net.peerCount : 1;
  }

  /** Iterate over connected players only */
  *[Symbol.iterator](): IterableIterator<PlayerInputContext> {
    const players = this.#inputs.players;
    const count = this.count;
    for (let i = 0; i < count; i++) {
      yield players[i]!;
    }
  }

  /** Iterate over connected players with their indices */
  *entries(): IterableIterator<[number, PlayerInputContext]> {
    const players = this.#inputs.players;
    const count = this.count;
    for (let i = 0; i < count; i++) {
      yield [i, players[i]!];
    }
  }
}

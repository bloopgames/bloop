import type {
  EnginePointer,
  InputContext,
  PlayerInputContext,
  TimeContext,
} from "@bloopjs/engine";
import type { BloopSchema } from "./data/schema";

export type Context<
  GS extends BloopSchema = BloopSchema,
  // Q extends Query<GS["CS"]> = Query<GS["CS"]>,
  // QS extends readonly Query<GS["CS"]>[] = readonly Query<GS["CS"]>[],
> = {
  /** The wrapper to the engine instance */
  // engine: Bridge<GS["CS"]>;
  /** Result of any resources requested */
  // resources: ResourcesResult<GS["RS"], R>;
  /** Result of the main query if there was one */
  // query: ResultsIterator<GS["CS"], Q>;
  /** Results of multiple queries if there were any */
  // queries: QueriesResults<GS["CS"], QS>;
  /** The bag of values for the system */
  bag: GS["B"];
  /** The timing information for the current frame */
  time: TimeContext;
  /** The input snapshot */
  inputs: InputContext;
  /**
   * Per-player input states. Shorthand for inputs.players.
   * Access via: context.players[0].keys.a.held
   */
  players: readonly PlayerInputContext[];
  /** The engine pointer to the injected system arguments (for advanced use cases) */
  rawPointer: EnginePointer;
  /**
   * Number of peers in the current session (0 if not in a multiplayer session).
   * Use this to detect when a remote peer has connected.
   */
  peerCount: number;
};

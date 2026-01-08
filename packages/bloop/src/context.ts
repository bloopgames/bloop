import type {
  EnginePointer,
  InputContext,
  NetContext,
  TimeContext,
} from "@bloopjs/engine";
import type { BloopSchema } from "./data/schema";
import type { Players } from "./players";

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
   * Per-player input states.
   * Access via: context.players.get(0).keys.a.held
   * Iterate connected players: for (const p of context.players) { ... }
   */
  players: Players;
  /** The engine pointer to the injected system arguments (for advanced use cases) */
  rawPointer: EnginePointer;
  /** Network context for multiplayer sessions */
  net: NetContext;
};

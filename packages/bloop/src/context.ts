import type { InputSnapshot } from "@bloopjs/engine";
import type { GameSchema } from "./data/schema";

export type Context<
  GS extends GameSchema = GameSchema,
  // Q extends Query<GS["CS"]> = Query<GS["CS"]>,
  // QS extends readonly Query<GS["CS"]>[] = readonly Query<GS["CS"]>[],
> = {
  /** The wrapper to the engine instance */
  // engine: Bridge<GS["CS"]>;
  /** The engine pointer to the injected system arguments (for advanced use cases) */
  // rawPointer: EnginePointer;
  /** Result of any resources requested */
  // resources: ResourcesResult<GS["RS"], R>;
  /** Result of the main query if there was one */
  // query: ResultsIterator<GS["CS"], Q>;
  /** Results of multiple queries if there were any */
  // queries: QueriesResults<GS["CS"], QS>;
  /** The bag of values for the system */
  bag: GS["B"];
  /** The input snapshot */
  inputs: InputSnapshot;
  /** The timing information for the current frame */
  time: TimingSnapshot;
};

export type TimingSnapshot = {
  /** The number of seconds (usually fractional) since the last frame */
  dt: number;
  /** The total number of seconds since the engine started */
  time: number;
  /** The number of frames rendered since the engine started */
  frame: number;

  /** The current frame rate of the engine in frames per second */
  // fps: number;
  /** The number of frames rendered since the engine started */
  highResFrame: bigint;
  /** The total number of milliseconds since the engine started */
  highResTime: bigint;
};

import type { BloopSchema } from "./data/schema";
import type { Bag } from "./data/bag";
import type { System } from "./system";
import { InputContext, TimeContext, type EnginePointer } from "@bloopjs/engine";
import { type Context } from "./context";

export type BloopOpts<B extends Bag> = {
  /** defaults to "Game" */
  name?: string;
  /**
   * component definitions, defaults to empty object
   *
   * use `defineComponents` to generate component definitions from a simple schema
   */
  // components?: SchemaWithLayout<CS>;
  /**
   * input map, defaults to empty object
   */
  // inputMap?: IM;
  /**
   * bag definition, defaults to empty object
   *
   */
	bag?: B
	// schema: GS;
};

export class Bloop<GS extends BloopSchema> {
	#systems: System<GS>[] = [];
	#context: Context<GS>;
	#engineBuffer: ArrayBuffer = new ArrayBuffer(0);

	/**
   * Bloop.create() is the way to create a new bloop instance.
   */
  static create<
    // S extends Schema,
    // RS extends ResourceSchema,
    B extends Bag,
    // const IM extends InputMap,
  // >(opts: GameOpts<S, RS, B, IM> = {}) {
  >(opts: BloopOpts<B> = {}): Bloop<MakeGS<B>> {
    return new Bloop<MakeGS<B>>(opts, "dontCallMeDirectly");
  }

	constructor(opts: BloopOpts<GS["B"]> = {}, dontCallMeDirectly: string) {
		if (dontCallMeDirectly !== "dontCallMeDirectly") {
			throw new Error(
				"Bloop constructor is private. Use Bloop.create() to create a new game instance."
			);
		}

		this.#context = {
      bag: opts.bag ?? {},
			time: new TimeContext(),
			inputs: new InputContext(),
    };
	}

	get bag(): GS["B"] {
		return this.#context.bag;
	}

	get context() : Readonly<Context<GS>> {
		return this.#context;
	}

	/**
	 * Take a snapshot of the game state
	 * @returns linear memory representation of the game state
	 */
	snapshot(): Uint8Array {
		throw new Error("Not implemented");

		// const str = JSON.stringify(this.#context.bag);
		// const encoder = new TextEncoder();
		// const textBytes = encoder.encode(str);

		// const size = EngineTiming.TIMING_SNAPSHOT_SIZE + 4 + textBytes.length;

		// const buffer = new Uint8Array(size);
		// const view = new DataView(buffer.buffer);
		// let offset = EngineTiming.encodeTimingSnapshot(this.#context.time, buffer.subarray(0, EngineTiming.TIMING_SNAPSHOT_SIZE));
		// view.setUint32(offset, textBytes.length, true);
		// offset += 4;

		// buffer.set(textBytes, offset);
		// offset += textBytes.length;
		// return buffer;
	}

	restore(snapshot: Uint8Array) {
		throw new Error("Not implemented");
		// const size = EngineTiming.decodeTimingSnapshot(new Uint8Array(snapshot.buffer, 0, EngineTiming.TIMING_SNAPSHOT_SIZE), this.#context.time);
		// const view = new DataView(snapshot.buffer);
		// let offset = size;
		// const length = view.getUint32(offset, true);
		// offset += 4;
		// const bagBytes = snapshot.slice(offset, offset + length);
		// const decoder = new TextDecoder();
		// const str = decoder.decode(bagBytes);
		// this.#context.bag = JSON.parse(str);
	}

	/**
	 * Register a system with the game loop.
	 *
	 */
	system(label: string, system: System<GS>): number {
		system.label ??= label;
		this.#systems.push(system);
		return this.#systems.length;
	}

	systemsCallback(system_handle: number, ptr: EnginePointer) {
		for (const system of this.#systems) {
			system.update?.(this.#context);
		}

		// 	for (const event of events) {
		// 		switch(event.type) {
		// 			case "keydown":
		// 				system.keydown?.({
		// 					...this.#context,
		// 					event: {
		// 						key: event.key,
		// 						pressure: 1,
		// 					}
		// 				})
		// 				break;
		// 			case "keyup":
		// 				system.keyup?.({
		// 					...this.#context,
		// 					event: {
		// 						key: event.key,
		// 						pressure: 0,
		// 					}
		// 				})
		// 				break;
		// 			case "mousemove":
		// 				system.mousemove?.({
		// 					...this.#context,
		// 					event: {
		// 						x: event.x,
		// 						y: event.y,
		// 					}
		// 				})
		// 				break;
		// 			case "mousedown":
		// 				system.mousedown?.({
		// 					...this.#context,
		// 					event: {
		// 						button: event.button,
		// 						pressure: event.pressure,
		// 					}
		// 				})
		// 				break;
		// 			case "mouseup":
		// 				system.mouseup?.({
		// 					...this.#context,
		// 					event: {
		// 						button: event.button,
		// 						pressure: event.pressure,
		// 					}
		// 				})
		// 				break;
		// 			case "mousewheel":
		// 				system.mousewheel?.({
		// 					...this.#context,
		// 					event: {
		// 						x: event.x,
		// 						y: event.y,
		// 					}
		// 				})
		// 				break;
		// 			default:
		// 				break;
		// 		}
		// 	}
		// }


		// this.#context.inputs.flush();
	}

	extra = {
		setBuffer: (buffer: ArrayBuffer) => {
			this.#engineBuffer = buffer;
			this.#context.time.dataView = new DataView(this.#engineBuffer);
		}
	}
}

type MakeGS<B extends Bag> = BloopSchema<B>;



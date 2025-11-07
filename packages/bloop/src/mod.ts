import type { BloopSchema } from "./data/schema";
import type { Bag } from "./data/bag";
import type { System } from "./system";
import { EngineInputs, type PlatformEvent } from "@bloopjs/engine";
import { decodeTimingSnapshot, encodeTimingSnapshot, TIMING_SNAPSHOT_SIZE, type Context } from "./context";

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

type MakeGS<B extends Bag> = BloopSchema<B>;

export class Bloop<GS extends BloopSchema> {
	#systems: System<GS>[] = [];
	#context: Context<GS>;

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
			// todo: this should be a pointer to memory managed by the engine
      inputs: new EngineInputs.InputSnapshot(new DataView(new ArrayBuffer(100))),
      time: {
				dt: 0,
				time: 0,
				frame: 0,
				highResFrame: 0n,
				highResTime: 0n,
			},
    };
	}

	get bag() {
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
		const str = JSON.stringify(this.#context.bag);
		const encoder = new TextEncoder();
		const textBytes = encoder.encode(str);

		const size = TIMING_SNAPSHOT_SIZE + 4 + textBytes.length;

		const buffer = new Uint8Array(size);
		const view = new DataView(buffer.buffer);
		let offset = encodeTimingSnapshot(this.#context.time, buffer.subarray(0, TIMING_SNAPSHOT_SIZE));
		view.setUint32(offset, textBytes.length, true);
		offset += 4;

		buffer.set(textBytes, offset);
		offset += textBytes.length;
		return buffer;
	}

	restore(snapshot: Uint8Array) {
		const size = decodeTimingSnapshot(new Uint8Array(snapshot.buffer, 0, 32), this.#context.time);
		const view = new DataView(snapshot.buffer);
		let offset = size;
		const length = view.getUint32(0, true);
		offset += 4;
		const bagBytes = snapshot.slice(offset, offset + length);
		const decoder = new TextDecoder();
		const str = decoder.decode(bagBytes);
		this.#context.bag = JSON.parse(str);

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

	// todo - get data from ptr
	systemsCallback(ptr: number, events: PlatformEvent[], dt: number) {
		this.#context.inputs.update(events);
		const dtSeconds = dt / 1000;
		this.#context.time.dt = dtSeconds;
		this.#context.time.time += dtSeconds;
		this.#context.time.highResTime += BigInt(dt);

		for (const system of this.#systems) {
			system.update?.(this.#context);

			for (const event of events) {
				switch(event.type) {
					case "keydown":
						system.keydown?.({
							...this.#context,
							event: {
								key: event.key,
								pressure: 1,
							}
						})
						break;
					case "keyup":
						system.keyup?.({
							...this.#context,
							event: {
								key: event.key,
								pressure: 0,
							}
						})
						break;
					case "mousemove":
						system.mousemove?.({
							...this.#context,
							event: {
								x: event.x,
								y: event.y,
							}
						})
						break;
					case "mousedown":
						system.mousedown?.({
							...this.#context,
							event: {
								button: event.button,
								pressure: event.pressure,
							}
						})
						break;
					case "mouseup":
						system.mouseup?.({
							...this.#context,
							event: {
								button: event.button,
								pressure: event.pressure,
							}
						})
						break;
					case "mousewheel":
						system.mousewheel?.({
							...this.#context,
							event: {
								x: event.x,
								y: event.y,
							}
						})
						break;
					default:
						break;
				}
			}
		}

		// do this in the engine snapshot
		this.#context.time.frame++;
		this.#context.time.highResFrame += 1n;

		this.#context.inputs.flush();
	}
}


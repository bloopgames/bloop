import type { BloopSchema } from "./data/schema";
import type { Bag } from "./data/bag";
import type { System } from "./system";
import { EngineEvents, Enums, InputContext, keyCodeToKey, mouseButtonCodeToMouseButton, TimeContext, type EnginePointer } from "@bloopjs/engine";
import { type Context } from "./context";
import { toHexString } from "./data/helpers";

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
		// todo - move this to engine
		const dv = new DataView(this.#engineBuffer, ptr);
		const timeCtxPtr = dv.getUint32(0, true);
		const inputCtxPtr = dv.getUint32(4, true);
		const eventsPtr = dv.getUint32(8, true);

		this.#context.inputs.dataView = new DataView(this.#engineBuffer, inputCtxPtr);
		this.#context.time.dataView = new DataView(this.#engineBuffer, timeCtxPtr);

		const eventsDataView = new DataView(this.#engineBuffer, eventsPtr);

		for (const system of this.#systems) {
			system.update?.(this.#context);

			const eventCount = eventsDataView.getUint32(0, true);

			let offset = 4;

			for (let i = 0; i < eventCount; i++) {
				const eventType = eventsDataView.getUint8(offset);
				// const payloadSize = eventType === Enums.EventType.MouseMove || eventType === Enums.EventType.MouseWheel ? 8 : 4;
				const payloadSize = 8;
				const payloadByte = eventsDataView.getUint8(offset + 4);
				const payloadVec2 = { x: eventsDataView.getFloat32(offset + 4, true), y: eventsDataView.getFloat32(offset + 8, true) };

				switch(eventType) {
					case Enums.EventType.KeyDown:
						system.keydown?.({
							...this.#context,
							event: {
								key: keyCodeToKey(payloadByte),
								pressure: 1,
							}
						})
						break;
					case Enums.EventType.KeyUp:
						system.keyup?.({
							...this.#context,
							event: {
								key: keyCodeToKey(payloadByte),
								pressure: 0,
							}
						})
						break;
					case Enums.EventType.MouseDown:
						system.mousedown?.({
							...this.#context,
							event: {
								button: mouseButtonCodeToMouseButton(payloadByte),
								pressure: 1,
							}
						})
						break;
					case Enums.EventType.MouseUp:
						system.mouseup?.({
							...this.#context,
							event: {
								button: mouseButtonCodeToMouseButton(payloadByte),
								pressure: 0,
							}
						})
						break;
					case Enums.EventType.MouseMove:
						system.mousemove?.({
							...this.#context,
							event: payloadVec2,
						})
						break;
					case Enums.EventType.MouseWheel:
						system.mousewheel?.({
							...this.#context,
							event: payloadVec2,
						})
						break;
					default:
						throw new Error(`Unknown event type: ${eventType}`);
				}
				offset += 4 + payloadSize;
			}
		}
	}

	setBuffer(buffer: ArrayBuffer) {
		this.#engineBuffer = buffer;
	}
}

type MakeGS<B extends Bag> = BloopSchema<B>;



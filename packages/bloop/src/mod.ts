import type { BloopSchema } from "./data/schema";
import type { Bag } from "./data/bag";
import type { System } from "./system";
import { EngineInputs, type PlatformEvent } from "@bloopjs/engine";
import type { Context } from "./context";

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
	#bag: GS["B"];
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

		this.#bag = opts.bag ?? {};
		this.#context = {
      bag: this.#bag,
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
		return this.#bag;
	}

	/**
	 * Register a system with the game loop.
	 *
	 */
	system(label: string, system: System): number {
		system.label ??= label;
		this.#systems.push(system);
		return this.#systems.length;
	}

	systemsCallback(events: PlatformEvent[]) {
		this.#context.inputs.update(events);
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
		this.#context.inputs.flush();
	}
}


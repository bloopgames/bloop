import {
  type EnginePointer,
  Enums,
  InputContext,
  keyCodeToKey,
  mouseButtonCodeToMouseButton,
  TimeContext,
} from "@bloopjs/engine";
import type { Context } from "./context";
import type { Bag } from "./data/bag";
import type { BloopSchema } from "./data/schema";
import type {
  InputEvent,
  KeyEvent,
  MouseButtonEvent,
  MouseMoveEvent,
  MouseWheelEvent,
} from "./events";
import type { DeserializeFn, SerializeFn } from "./runtime";
import type { System } from "./system";

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
  bag?: B;
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
        "Bloop constructor is private. Use Bloop.create() to create a new game instance.",
      );
    }

    this.#context = {
      bag: opts.bag ?? {},
      time: new TimeContext(),
      inputs: new InputContext(),
      rawPointer: -1,
    };
  }

  get bag(): GS["B"] {
    return this.#context.bag;
  }

  get context(): Readonly<Context<GS>> {
    return this.#context;
  }

  /**
   * Take a snapshot of the game state outside the engine
   * @returns linear memory representation of the game state that the engine is unaware of
   */
  serialize = (): ReturnType<SerializeFn> => {
    const str = JSON.stringify(this.#context.bag);
    const encoder = new TextEncoder();
    const textBytes = encoder.encode(str);

    return {
      size: textBytes.byteLength,
      write: (buffer: ArrayBufferLike, ptr: EnginePointer) => {
        const memoryView = new Uint8Array(buffer, ptr, textBytes.byteLength);
        memoryView.set(textBytes);
      },
    };
  };

  /**
   * Restore a snapshot of the game state outside the engine
   * @returns linear memory representation of the game state that the engine is unaware of
   */
  deserialize: DeserializeFn = (buffer, ptr, len) => {
    const bagBytes = new Uint8Array(buffer, ptr, len);
    const decoder = new TextDecoder();
    const str = decoder.decode(bagBytes);

    try {
      this.#context.bag = JSON.parse(str);
    } catch (e) {
      console.error("failed to deserialize bag", { json: str, error: e });
    }
  };

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

    this.#context.rawPointer = ptr;
    this.#context.inputs.dataView = new DataView(
      this.#engineBuffer,
      inputCtxPtr,
    );
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
        const payloadVec2 = {
          x: eventsDataView.getFloat32(offset + 4, true),
          y: eventsDataView.getFloat32(offset + 8, true),
        };

        switch (eventType) {
          case Enums.EventType.KeyDown: {
            system.keydown?.(
              attachEvent<KeyEvent, GS>(this.#context, {
                key: keyCodeToKey(payloadByte),
              }),
            );
            break;
          }
          case Enums.EventType.KeyUp:
            system.keyup?.(
              attachEvent<KeyEvent, GS>(this.#context, {
                key: keyCodeToKey(payloadByte),
              }),
            );
            break;
          case Enums.EventType.MouseDown:
            system.mousedown?.(
              attachEvent<MouseButtonEvent, GS>(this.#context, {
                button: mouseButtonCodeToMouseButton(payloadByte),
              }),
            );
            break;
          case Enums.EventType.MouseUp:
            system.mouseup?.(
              attachEvent<MouseButtonEvent, GS>(this.#context, {
                button: mouseButtonCodeToMouseButton(payloadByte),
              }),
            );
            break;
          case Enums.EventType.MouseMove:
            system.mousemove?.(
              attachEvent<MouseMoveEvent, GS>(this.#context, {
                x: payloadVec2.x,
                y: payloadVec2.y,
              }),
            );
            break;
          case Enums.EventType.MouseWheel:
            system.mousewheel?.(
              attachEvent<MouseWheelEvent, GS>(this.#context, {
                x: payloadVec2.x,
                y: payloadVec2.y,
              }),
            );
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

function attachEvent<IE extends InputEvent, GS extends BloopSchema>(
  context: Context<GS>,
  event: IE,
): Context<GS> & { event: IE } {
  (context as any).event = event;
  return context as Context<GS> & { event: IE };
}

type MakeGS<B extends Bag> = BloopSchema<B>;

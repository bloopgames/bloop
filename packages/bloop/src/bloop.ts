import {
  type EnginePointer,
  Enums,
  EVENT_PAYLOAD_ALIGN,
  EVENT_PAYLOAD_SIZE,
  EVENTS_OFFSET,
  INPUT_CTX_OFFSET,
  InputContext,
  keyCodeToKey,
  mouseButtonCodeToMouseButton,
  TIME_CTX_OFFSET,
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
import type { EngineHooks } from "./sim";
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

  /**
   * DO NOT USE `new Bloop` - use `Bloop.create()` instead for proper type hints.
   */
  constructor(opts: BloopOpts<GS["B"]> = {}, dontCallMeDirectly: string) {
    if (dontCallMeDirectly !== "dontCallMeDirectly") {
      throw new Error(
        "Bloop constructor is private. Use Bloop.create() to create a new game instance.",
      );
    }

    const inputs = new InputContext();
    this.#context = {
      bag: opts.bag ?? {},
      time: new TimeContext(),
      inputs,
      get players() {
        return inputs.players;
      },
      rawPointer: -1,
    };
  }

  /**
   * Read the game singleton bag
   */
  get bag(): GS["B"] {
    return this.#context.bag;
  }

  /**
   * Read the game context object
   */
  get context(): Readonly<Context<GS>> {
    return this.#context;
  }

  /**
   * Register a system with the game loop.
   */
  system(label: string, system: System<GS>): number {
    system.label ??= label;
    this.#systems.push(system);
    return this.#systems.length;
  }

  /**
   * Low level hooks to engine functionality. Editing these is for advanced use cases, defaults should usually work.
   */
  hooks: EngineHooks = {
    /**
     * Take a snapshot of the game state outside the engine
     * @returns linear memory representation of the game state that the engine is unaware of
     */
    serialize: () => {
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
    },

    /**
     * Restore a snapshot of the game state outside the engine
     * @returns linear memory representation of the game state that the engine is unaware of
     */
    deserialize: (buffer, ptr, len) => {
      const bagBytes = new Uint8Array(buffer, ptr, len);
      const decoder = new TextDecoder();
      const str = decoder.decode(bagBytes);

      try {
        this.#context.bag = JSON.parse(str);
      } catch (e) {
        console.error("failed to deserialize bag", { json: str, error: e });
      }
    },

    setBuffer: (buffer: ArrayBuffer) => {
      this.#engineBuffer = buffer;
    },

    setContext: (ptr: EnginePointer) => {
      // todo - move this to engine
      if (!this.#engineBuffer) {
        throw new Error("Tried to set context before engine buffer");
      }
      const dv = new DataView(this.#engineBuffer, ptr);
      const timeCtxPtr = dv.getUint32(TIME_CTX_OFFSET, true);
      const inputCtxPtr = dv.getUint32(INPUT_CTX_OFFSET, true);

      this.#context.rawPointer = ptr;
      // todo - only rebuild these if the buffer has changed due to memory growth or the pointers have changed
      this.#context.inputs.dataView = new DataView(
        this.#engineBuffer,
        inputCtxPtr,
      );
      this.#context.time.dataView = new DataView(
        this.#engineBuffer,
        timeCtxPtr,
      );
    },

    systemsCallback: (system_handle: number, ptr: EnginePointer) => {
      this.hooks.setContext(ptr);
      const dv = new DataView(this.#engineBuffer, ptr);
      const eventsPtr = dv.getUint32(EVENTS_OFFSET, true);
      const eventsDataView = new DataView(this.#engineBuffer, eventsPtr);

      for (const system of this.#systems) {
        system.update?.(this.#context);

        // EventBuffer: count (u16) + padding (2 bytes) + events
        // TODO: it would be better to have all the offset math centralized to the
        // engine package, and just do something like
        // const {jsEvent, size} = engine.decodeEvent(eventPtr, eventOffset)
        // eventOffset += size;

        const eventCount = eventsDataView.getUint16(0, true);
        let offset = 4; // Skip count (u16) + padding (2 bytes)

        for (let i = 0; i < eventCount; i++) {
          // Event layout: kind (u8) + source (u8) + padding (2 bytes) + payload (8 bytes) = 12 bytes
          const eventType = eventsDataView.getUint8(offset);
          const eventSource = eventsDataView.getUint8(offset + 1);
          const payloadOffset = offset + 4; // Skip kind + source + padding
          const payloadByte = eventsDataView.getUint8(payloadOffset);
          const payloadVec2 = {
            x: eventsDataView.getFloat32(payloadOffset, true),
            y: eventsDataView.getFloat32(
              payloadOffset + Float32Array.BYTES_PER_ELEMENT,
              true,
            ),
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
          // Event is 12 bytes: kind (1) + source (1) + padding (2) + payload (8)
          offset += 12;
        }
        (this.#context as any).event = undefined;
      }
    },
  };
}

function attachEvent<IE extends InputEvent, GS extends BloopSchema>(
  context: Context<GS>,
  event: IE,
): Context<GS> & { event: IE } {
  (context as any).event = event;
  return context as Context<GS> & { event: IE };
}

type MakeGS<B extends Bag> = BloopSchema<B>;

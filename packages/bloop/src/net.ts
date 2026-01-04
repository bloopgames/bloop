import type { EnginePointer, WasmEngine } from "@bloopjs/engine";
import { assert } from "./util";

/**
 * Network API for packet management in multiplayer sessions.
 *
 * This class provides methods for:
 * - Building outbound packets to send to peers
 * - Processing received packets
 *
 * Access via `sim.net` after initializing a session.
 */
export class Net {
  #wasm: WasmEngine;
  #memory: WebAssembly.Memory;

  constructor(wasm: WasmEngine, memory: WebAssembly.Memory) {
    this.#wasm = wasm;
    this.#memory = memory;
  }

  /**
   * Get an outbound packet to send to a target peer.
   * Returns a copy of the packet data (caller owns the returned buffer).
   *
   * The packet contains all unacked inputs encoded in wire format.
   *
   * @param targetPeer - Peer ID to send the packet to
   * @returns Packet data to send, or null if no packet available
   */
  getOutboundPacket(targetPeer: number): Uint8Array<ArrayBuffer> | null {
    // Build the packet in engine memory
    this.#wasm.build_outbound_packet(targetPeer);

    const len = this.#wasm.get_outbound_packet_len();
    if (len === 0) {
      throw new Error(`No outbound packet available for peer ${targetPeer}`);
    }

    const ptr = this.#wasm.get_outbound_packet();
    assert(ptr > 0, `Invalid outbound packet pointer: ${ptr}`);

    // Copy from WASM memory
    const memoryView = new Uint8Array(this.#memory.buffer, ptr, len);
    const copy = new Uint8Array(len);
    copy.set(memoryView);

    return copy;
  }
}

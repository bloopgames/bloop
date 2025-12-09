import type { EnginePointer, WasmEngine } from "@bloopjs/engine";
import { assert } from "./util";

/**
 * Network API for packet management in multiplayer sessions.
 *
 * This class provides methods for:
 * - Building outbound packets to send to peers
 * - Processing received packets
 * - Querying peer network state (seq/ack/unacked)
 * - Managing peer connections
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
   * Set the local peer ID for packet encoding.
   * Call this after session init to identify which peer we are.
   */
  setLocalPeer(peerId: number): void {
    this.#wasm.session_set_local_peer(peerId);
  }

  /**
   * Mark a peer as connected for packet management.
   * Call this when a peer joins the session.
   */
  connectPeer(peerId: number): void {
    this.#wasm.session_peer_connect(peerId);
  }

  /**
   * Mark a peer as disconnected.
   * Call this when a peer leaves the session.
   */
  disconnectPeer(peerId: number): void {
    this.#wasm.session_peer_disconnect(peerId);
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
      return null;
    }

    const ptr = this.#wasm.get_outbound_packet();
    assert(ptr > 0, `Invalid outbound packet pointer: ${ptr}`);

    // Copy from WASM memory
    const memoryView = new Uint8Array(this.#memory.buffer, ptr, len);
    const copy = new Uint8Array(len);
    copy.set(memoryView);

    return copy;
  }

  /**
   * Process a received packet from a peer.
   * This updates seq/ack state and stores events for rollback.
   *
   * @param data - Packet data received from the network
   * @throws Error if packet is invalid
   */
  receivePacket(data: Uint8Array): void {
    if (data.length === 0) {
      return;
    }

    // Allocate memory and copy packet
    const ptr = this.#wasm.alloc(data.byteLength);
    assert(
      ptr > 0,
      `Failed to allocate ${data.byteLength} bytes for received packet`,
    );

    const memoryView = new Uint8Array(
      this.#memory.buffer,
      ptr,
      data.byteLength,
    );
    memoryView.set(data);

    // Process the packet
    const result = this.#wasm.receive_packet(ptr, data.byteLength);

    // Free the allocated memory
    this.#wasm.free(ptr, data.byteLength);

    // Check result
    if (result !== 0) {
      const errorMessages: Record<number, string> = {
        1: "No active session",
        2: "Buffer too small",
        3: "Unsupported packet version",
        4: "Invalid event count",
      };
      throw new Error(
        errorMessages[result] ?? `Unknown packet error: ${result}`,
      );
    }
  }

  /**
   * Get network state for a specific peer.
   *
   * @param peer - Peer ID to query
   * @returns Object with seq and ack
   */
  getPeerState(peer: number): {
    seq: number;
    ack: number;
  } {
    return {
      seq: this.#wasm.get_peer_seq(peer),
      ack: this.#wasm.get_peer_ack(peer),
    };
  }
}

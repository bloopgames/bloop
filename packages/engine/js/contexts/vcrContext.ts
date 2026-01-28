import {
  VCR_CTX_IS_RECORDING_OFFSET,
  VCR_CTX_IS_REPLAYING_OFFSET,
  VCR_CTX_MAX_EVENTS_OFFSET,
  VCR_CTX_MAX_PACKET_BYTES_OFFSET,
  VCR_CTX_WANTS_RECORD_OFFSET,
  VCR_CTX_WANTS_STOP_OFFSET,
} from "../codegen/offsets";

/**
 * Options for starting a recording.
 */
export type RecordOptions = {
  /** Maximum number of events to record (default: 65535) */
  maxEvents?: number;
  /** Maximum packet bytes to record (default: 1MB = 1024 * 1024) */
  maxPacketBytes?: number;
};

/**
 * VCR (recording/replay) context for game systems.
 *
 * Allows games to:
 * - Check if currently recording or replaying
 * - Request to start/stop recording
 *
 * Recording state is managed by the engine; this context provides
 * read-only status and write-only control flags.
 */
export class VcrContext {
  dataView?: DataView;

  constructor(dataView?: DataView) {
    this.dataView = dataView;
  }

  /** Check if dataView is valid (not undefined and not detached) */
  #hasValidBuffer(): boolean {
    if (!this.dataView) return false;
    // Check if buffer is detached (byteLength becomes 0)
    return this.dataView.buffer.byteLength > 0;
  }

  /** True if currently recording */
  get isRecording(): boolean {
    if (!this.#hasValidBuffer()) {
      throw new Error("VcrContext dataView is not valid");
    }
    return this.dataView!.getUint8(VCR_CTX_IS_RECORDING_OFFSET) !== 0;
  }

  /** True if currently replaying a tape */
  get isReplaying(): boolean {
    if (!this.#hasValidBuffer()) {
      throw new Error("VcrContext dataView is not valid");
    }
    return this.dataView!.getUint8(VCR_CTX_IS_REPLAYING_OFFSET) !== 0;
  }

  /**
   * Request recording to start on the next frame.
   *
   * @param opts - Optional recording parameters
   * @param opts.maxEvents - Maximum number of events to record (default: 65535)
   * @param opts.maxPacketBytes - Maximum packet bytes to record (default: 1MB)
   *
   * @example
   * ```ts
   * // Start recording with defaults
   * vcr.wantsRecord();
   *
   * // Start recording with custom limits
   * vcr.wantsRecord({ maxEvents: 10000, maxPacketBytes: 512 * 1024 });
   * ```
   */
  wantsRecord(opts: RecordOptions = {}): void {
    if (!this.#hasValidBuffer()) {
      throw new Error("VcrContext dataView is not valid");
    }
    const maxEvents = opts.maxEvents ?? 65535;
    const maxPacketBytes = opts.maxPacketBytes ?? 1024 * 1024;

    // Set parameters first, then set the flag
    this.dataView!.setUint32(VCR_CTX_MAX_EVENTS_OFFSET, maxEvents, true);
    this.dataView!.setUint32(
      VCR_CTX_MAX_PACKET_BYTES_OFFSET,
      maxPacketBytes,
      true,
    );
    this.dataView!.setUint8(VCR_CTX_WANTS_RECORD_OFFSET, 1);
  }

  /**
   * Set to true to request recording stop on the next frame.
   *
   * @example
   * ```ts
   * vcr.wantsStop = true;
   * ```
   */
  set wantsStop(value: boolean) {
    if (!this.#hasValidBuffer()) {
      throw new Error("VcrContext dataView is not valid");
    }
    this.dataView!.setUint8(VCR_CTX_WANTS_STOP_OFFSET, value ? 1 : 0);
  }

  /** Check if a stop request is pending */
  get wantsStop(): boolean {
    if (!this.#hasValidBuffer()) {
      throw new Error("VcrContext dataView is not valid");
    }
    return this.dataView!.getUint8(VCR_CTX_WANTS_STOP_OFFSET) !== 0;
  }
}

import { PacketType } from "./protocol";

// Packet structure (prototype - should move to zig + codegen):
// [u8 packet_type] [u32 ack] [u32 seq] [u8 event_count]
// Each event: [u32 frame_number] [u8 event_type] [u8[8] event_payload]
export const PACKET_HEADER_SIZE = 1 + 4 + 4 + 1; // type + ack + seq + count
export const EVENT_SIZE = 4 + 1 + 8; // frame + type + payload
export const EVENT_PAYLOAD_SIZE = 8;

export type InputEvent = {
  frame: number;
  eventType: number;
  payload: Uint8Array; // 8 bytes
};

export type InputPacket = {
  type: PacketType.Inputs;
  ack: number;
  seq: number;
  events: InputEvent[];
};

export function encodeInputPacket(packet: InputPacket): ArrayBuffer {
  const buffer = new ArrayBuffer(
    PACKET_HEADER_SIZE + packet.events.length * EVENT_SIZE
  );
  const dv = new DataView(buffer);
  let offset = 0;

  // Write header
  dv.setUint8(offset, packet.type);
  offset += 1;
  dv.setUint32(offset, packet.ack, true);
  offset += 4;
  dv.setUint32(offset, packet.seq, true);
  offset += 4;
  dv.setUint8(offset, packet.events.length);
  offset += 1;

  // Write events
  for (const event of packet.events) {
    dv.setUint32(offset, event.frame, true);
    offset += 4;
    dv.setUint8(offset, event.eventType);
    offset += 1;
    // Copy payload bytes
    const bytes = new Uint8Array(buffer, offset, EVENT_PAYLOAD_SIZE);
    bytes.set(event.payload);
    offset += EVENT_PAYLOAD_SIZE;
  }

  return buffer;
}

export function decodeInputPacket(data: Uint8Array): InputPacket | null {
  if (data.byteLength < PACKET_HEADER_SIZE) {
    return null;
  }

  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const type = dv.getUint8(offset);
  offset += 1;
  if (type !== PacketType.Inputs) {
    return null;
  }

  const ack = dv.getUint32(offset, true);
  offset += 4;
  const seq = dv.getUint32(offset, true);
  offset += 4;
  const eventCount = dv.getUint8(offset);
  offset += 1;

  const events: InputEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    if (offset + EVENT_SIZE > data.byteLength) {
      break; // Incomplete packet
    }

    const frame = dv.getUint32(offset, true);
    offset += 4;
    const eventType = dv.getUint8(offset);
    offset += 1;
    const payload = new Uint8Array(data.buffer, data.byteOffset + offset, EVENT_PAYLOAD_SIZE);
    offset += EVENT_PAYLOAD_SIZE;

    events.push({
      frame,
      eventType,
      payload: payload.slice(), // Copy the bytes
    });
  }

  return {
    type: PacketType.Inputs,
    ack,
    seq,
    events,
  };
}

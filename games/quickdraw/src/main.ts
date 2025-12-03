import "./style.css";
import { Util } from "@bloopjs/bloop";
import { Enums } from "@bloopjs/engine";
import { start } from "@bloopjs/web";
import { createApp } from "vue";
import App from "./App.vue";
import { game, makePeer } from "./game";
import { joinRoom } from "./netcode/broker";
import {
  decodeInputPacket,
  EVENT_PAYLOAD_SIZE,
  EVENT_SIZE,
  encodeInputPacket,
  type InputEvent,
} from "./netcode/inputs";
import type { Logger, LogOpts } from "./netcode/logs";
import type { PeerId } from "./netcode/protocol";
import { PacketType } from "./netcode/protocol";
import { netcode } from "./netcode/transport";
import { logs } from "./ui";

const vueApp = createApp(App);
vueApp.mount("#app");

// Parse artificial lag from URL params (e.g., ?lag=100 for 100ms)
const urlParams = new URLSearchParams(window.location.search);
const artificialLag = parseInt(urlParams.get("lag") || "0", 10);
if (artificialLag > 0) {
  console.log(`[netcode] Artificial lag enabled: ${artificialLag}ms`);
}

const monorepoWasmUrl = new URL("/bloop-wasm/bloop.wasm", window.location.href);
const app = await start({
  game,
  engineWasmUrl: monorepoWasmUrl,
  startRecording: false,
});

// Set screen dimensions from actual window size
game.bag.screenWidth = window.innerWidth;
game.bag.screenHeight = window.innerHeight;
game.bag.blockX = game.bag.screenWidth / 2; // Re-center the block

let udp: RTCDataChannel;

const logger: Logger = {
  log: (log: LogOpts) => {
    logs.value.push({
      ...log,
      timestamp: Date.now(),
      frame_number: app.sim.time.frame,
      severity: "log",
    });
  },
  warn: (log: LogOpts) => {
    logs.value.push({
      ...log,
      timestamp: Date.now(),
      frame_number: app.sim.time.frame,
      severity: "warn",
    });
  },
  error: (log: LogOpts) => {
    logs.value.push({
      ...log,
      timestamp: Date.now(),
      frame_number: app.sim.time.frame,
      severity: "error",
    });
  },
};

netcode.logRtc = (...args: any[]) => {
  logger.log({
    source: "webrtc",
    json: args,
  });
};
netcode.logWs = (...args: any[]) => {
  logger.log({
    source: "ws",
    json: args,
  });
};

const packets = new Map<PeerId, Uint8Array[]>();

let lastSample = 0;
const SAMPLE_RATE = 120; // how many packets to receive before logging

joinRoom("nope", logger, {
  onPeerIdAssign: (peerId) => {
    console.log(`Assigned peer ID: ${peerId}`);
  },
  onBrokerMessage: (message) => {},
  onMessage(peerId, data, reliable) {
    if (!packets.has(peerId)) {
      packets.set(peerId, []);
    }
    packets.get(peerId)!.push(new Uint8Array(data));
    if (lastSample-- <= 0) {
      logger.log({
        source: "webrtc",
        from: peerId,
        reliable,
        packet: {
          size: data.byteLength,
          bytes: new Uint8Array(data),
        },
      });
      lastSample = SAMPLE_RATE;
    }
  },
  onDataChannelClose(peerId, reliable) {
    console.log(`Data channel closed: ${peerId} (reliable: ${reliable})`);
  },
  onDataChannelOpen(peerId, reliable, channel) {
    console.log(`Data channel opened: ${peerId} (reliable: ${reliable})`);
    if (!reliable) {
      udp = channel;
    }
  },
  onPeerConnected(peerId) {
    console.log(`[netcode] Peer connected: ${peerId}`);
    game.bag.peers.push(makePeer(peerId));
    console.log(`[netcode] Total peers: ${game.bag.peers.length}`);
  },
  onPeerDisconnected(peerId) {
    game.bag.peers = game.bag.peers.filter((p) => p.id !== peerId);
  },
});

// Read events from the engine event buffer
function readEventsFromEngine(frame: number): InputEvent[] {
  const eventsPtr = app.sim.wasm.get_events_ptr();
  const buffer = app.sim.buffer;

  const dv = new DataView(buffer, eventsPtr);
  const eventCount = dv.getUint8(0); // First byte is count

  const events: InputEvent[] = [];
  let offset = 4; // Skip past count (u32 aligned)

  for (let i = 0; i < eventCount; i++) {
    const eventType = dv.getUint8(offset);
    offset += 4; // Event type is u8 but aligned to 4 bytes

    const payload = new Uint8Array(EVENT_PAYLOAD_SIZE);
    for (let j = 0; j < EVENT_PAYLOAD_SIZE; j++) {
      payload[j] = dv.getUint8(offset + j);
    }
    offset += EVENT_PAYLOAD_SIZE;

    events.push({
      frame,
      eventType,
      payload,
    });
  }

  return events;
}

// Maintain unacked events by frame
const unackedEvents = new Map<number, InputEvent[]>();
let nextSeq = 0;
let remoteSeq = 0; // Latest seq we've received from remote (we send this back as our ack)

// Helper to inject an event into the engine
// isRemote: true if this event came from another player
function injectEvent(
  eventType: number,
  payload: Uint8Array,
  isRemote: boolean
) {
  // For remote events, translate mouse clicks to 'l' key (player 2)
  if (isRemote) {
    if (eventType === Enums.EventType.MouseDown) {
      app.sim.wasm.emit_keydown(Enums.Key.KeyL);
      return;
    }
    if (eventType === Enums.EventType.MouseUp) {
      app.sim.wasm.emit_keyup(Enums.Key.KeyL);
      return;
    }
    if (eventType === Enums.EventType.MouseMove) {
      const dv = new DataView(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength
      );
      const x = dv.getFloat32(0, true);
      const y = dv.getFloat32(4, true);
      // Update remote cursor position in the bag
      game.bag.remoteCursorX = x;
      game.bag.remoteCursorY = y;
      return;
    }
    // Ignore other remote events
    return;
  }

  // Map event types to engine emit functions for local events
  switch (eventType) {
    case Enums.EventType.KeyDown: {
      const keyCode = Util.unwrap(
        payload[0],
        "KeyDown payload missing keyCode"
      );
      app.sim.wasm.emit_keydown(keyCode);
      break;
    }
    case Enums.EventType.KeyUp: {
      const keyCode = Util.unwrap(payload[0], "KeyUp payload missing keyCode");
      app.sim.wasm.emit_keyup(keyCode);
      break;
    }
    case Enums.EventType.MouseDown: {
      const buttonCode = Util.unwrap(
        payload[0],
        "MouseDown payload missing buttonCode"
      );
      app.sim.wasm.emit_mousedown(buttonCode);
      break;
    }
    case Enums.EventType.MouseUp: {
      const buttonCode = Util.unwrap(
        payload[0],
        "MouseUp payload missing buttonCode"
      );
      app.sim.wasm.emit_mouseup(buttonCode);
      break;
    }
    case Enums.EventType.MouseMove: {
      const dv = new DataView(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength
      );
      const x = dv.getFloat32(0, true);
      const y = dv.getFloat32(4, true);
      app.sim.wasm.emit_mousemove(x, y);
      break;
    }
    case Enums.EventType.MouseWheel: {
      const dv = new DataView(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength
      );
      const deltaX = dv.getFloat32(0, true);
      const deltaY = dv.getFloat32(4, true);
      app.sim.wasm.emit_mousewheel(deltaX, deltaY);
      break;
    }
  }
}

app.beforeFrame.subscribe((frame) => {
  // Update time since last packet for all peers
  const now = Date.now();
  for (const peer of game.bag.peers) {
    if (peer.stats.lastPacketTime > 0) {
      peer.stats.timeSinceLastPacket = now - peer.stats.lastPacketTime;
    }
  }

  // Process incoming packets
  for (const [peerId, pkts] of packets) {
    // Find the peer
    const peer = game.bag.peers.find((p) => p.id === peerId);
    if (!peer) {
      console.warn(
        `[netcode] Received packet from unknown peer: ${peerId}, total peers: ${game.bag.peers.length}`
      );
    }

    for (const packetBuffer of pkts) {
      const packet = decodeInputPacket(packetBuffer);
      if (!packet) {
        console.warn(`[netcode] Failed to decode packet from ${peerId}`);
        continue;
      }

      // Update the latest seq we've received (we'll send this back as our ack)
      if (packet.seq > remoteSeq) {
        remoteSeq = packet.seq;
      }

      // Update peer stats
      if (peer) {
        peer.stats.currentSeq = packet.seq;
        peer.stats.currentAck = packet.ack;

        // Track packet timestamps for rate calculation (keep last 60 seconds)
        const cutoff = now - 60000;
        peer.stats.packetTimestamps = peer.stats.packetTimestamps.filter(
          (t) => t > cutoff
        );
        peer.stats.packetTimestamps.push(now);

        // Calculate packets per second
        peer.stats.packetsPerSecond = peer.stats.packetTimestamps.length / 60;

        // Calculate average delta
        if (peer.stats.packetTimestamps.length > 1) {
          const deltas: number[] = [];
          const timestamps = peer.stats.packetTimestamps;
          for (let i = 1; i < timestamps.length; i++) {
            const current = timestamps[i];
            const previous = timestamps[i - 1];
            if (current !== undefined && previous !== undefined) {
              deltas.push(current - previous);
            }
          }
          if (deltas.length > 0) {
            peer.stats.averagePacketDelta =
              deltas.reduce((a, b) => a + b, 0) / deltas.length;
          }
        }

        peer.stats.lastPacketTime = now;
        peer.stats.timeSinceLastPacket = 0;
      }

      // Process ack - remove events that have been confirmed received
      // packet.ack tells us the latest seq the remote peer has received from us
      if (packet.ack >= 0) {
        // Remove old unacked events (keep last 60 frames as a safety margin)
        for (const [eventFrame, _] of unackedEvents) {
          if (eventFrame < frame - 60) {
            unackedEvents.delete(eventFrame);
          }
        }
      }

      // Inject events with optional artificial lag
      // This will cause desync because events arrive late!
      const injectPacketEvents = () => {
        for (const event of packet.events) {
          // console.log(
          //   `[netcode] Injecting event from frame ${event.frame} into current frame ${frame} (lag: ${frame - event.frame})`
          // );
          injectEvent(event.eventType, event.payload, true); // isRemote = true
        }
      };

      if (artificialLag > 0) {
        setTimeout(injectPacketEvents, artificialLag);
      } else {
        injectPacketEvents();
      }
    }
  }
  packets.clear();
});

app.afterFrame.subscribe((frame) => {
  // Read events that occurred this frame
  const frameEvents = readEventsFromEngine(frame);

  if (frameEvents.length > 0) {
    unackedEvents.set(frame, frameEvents);
    // console.log(`[netcode] Frame ${frame}: ${frameEvents.length} events`);
  }

  if (!udp) {
    return;
  }

  // Collect all unacked events
  const allUnackedEvents: InputEvent[] = [];
  for (const events of unackedEvents.values()) {
    allUnackedEvents.push(...events);
  }

  // Debug: log event count occasionally
  if (frame % 60 === 0) {
    console.log(`[netcode] Frame ${frame}: ${allUnackedEvents.length} unacked events`);
  }

  // Always send packets (heartbeat/ack even with no events)
  const packet = encodeInputPacket({
    type: PacketType.Inputs,
    ack: remoteSeq, // Acknowledge the latest seq we received from remote
    seq: nextSeq++,
    events: allUnackedEvents,
  });

  // console.log(
  //   `[netcode] Sending packet: seq=${nextSeq - 1}, events=${
  //     allUnackedEvents.length
  //   }`
  // );
  udp.send(packet);
});

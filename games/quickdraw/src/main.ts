import "./style.css";
import { Util } from "@bloopjs/bloop";
import { Enums } from "@bloopjs/engine";
import { start } from "@bloopjs/web";
import { createApp } from "vue";
import App from "./App.vue";
import { connectedPeers, game, makePeer, peerStats } from "./game";
import { joinRoom } from "./netcode/broker";
import {
  decodeInputPacket,
  EVENT_PAYLOAD_SIZE,
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

// Parse URL params for netcode options
const urlParams = new URLSearchParams(window.location.search);
const artificialLag = parseInt(urlParams.get("lag") || "0", 10);
const skipRollback = urlParams.has("skipRollback");
if (artificialLag > 0) {
  console.log(`[netcode] Artificial lag enabled: ${artificialLag}ms`);
}
if (skipRollback) {
  console.log(`[netcode] Rollback disabled - using immediate injection`);
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

const net = {
  // Session timing: when the match starts, we capture the local frame number
  // All match frames are relative to this start frame
  sessionStartFrame: null as number | null,

  // Last confirmed snapshot for rollback - updated as inputs are confirmed
  confirmedState: null as { frame: number; snapshot: Uint8Array } | null,

  // Sequence numbers for reliable delivery
  nextSeq: 0,
  remoteSeq: 0, // Latest seq we've received from remote (we send this back as our ack)

  // Events by match frame for rollback resimulation
  localEvents: new Map<number, InputEvent[]>(),
  remoteEvents: new Map<number, InputEvent[]>(),
  unackedEvents: new Map<number, InputEvent[]>(),

  // The highest match frame where we've received remote inputs (-1 = none yet)
  latestRemoteFrame: -1,

  // Guard flag to prevent recursive rollback processing
  isResimulating: false,
};

const logger: Logger = {
  log: (log: LogOpts) => {
    const frame = app.sim.time.frame;
    logs.value.push({
      ...log,
      timestamp: Date.now(),
      frame_number: frame,
      match_frame:
        net.sessionStartFrame !== null ? frame - net.sessionStartFrame : null,
      severity: "log",
    });
  },
  warn: (log: LogOpts) => {
    const frame = app.sim.time.frame;
    logs.value.push({
      ...log,
      timestamp: Date.now(),
      frame_number: frame,
      match_frame:
        net.sessionStartFrame !== null ? frame - net.sessionStartFrame : null,
      severity: "warn",
    });
  },
  error: (log: LogOpts) => {
    const frame = app.sim.time.frame;
    logs.value.push({
      ...log,
      timestamp: Date.now(),
      frame_number: frame,
      match_frame:
        net.sessionStartFrame !== null ? frame - net.sessionStartFrame : null,
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

    const bytes = new Uint8Array(data);
    const inputPacket = decodeInputPacket(bytes);
    const hasEvents =
      inputPacket.events.filter(
        (e) =>
          ![Enums.EventType.MouseMove, Enums.EventType.MouseWheel].includes(
            e.eventType,
          ),
      ).length > 0;
    if (hasEvents) {
      logger.log({
        source: "webrtc",
        from: peerId,
        reliable,
        packet: {
          size: data.byteLength,
          bytes: new Uint8Array(data),
        },
      });
    }
  },
  onDataChannelClose(peerId, reliable) {
    console.log(`Data channel closed: ${peerId} (reliable: ${reliable})`);
  },
  onDataChannelOpen(peerId, reliable, channel) {
    console.log(`Data channel opened: ${peerId} (reliable: ${reliable})`);
    if (!reliable) {
      udp = channel;
      net.sessionStartFrame = app.sim.time.frame;
      net.confirmedState = {
        frame: 0,
        snapshot: app.sim.snapshot(),
      };
      console.log(
        `[netcode] Session started at local frame ${net.sessionStartFrame}, captured initial snapshot`,
      );
    }
  },
  onPeerConnected(peerId) {
    console.log(`[netcode] Peer connected: ${peerId}`);
    connectedPeers.push(makePeer(peerId));
    console.log(`[netcode] Total peers: ${connectedPeers.length}`);
  },
  onPeerDisconnected(peerId) {
    const idx = connectedPeers.findIndex((p) => p.id === peerId);
    if (idx !== -1) {
      connectedPeers.splice(idx, 1);
    }
  },
});

app.beforeFrame.subscribe((frame) => {
  if (net.isResimulating) {
    return;
  }

  try {
    receivePackets(frame);
    // without rollback,
    if (skipRollback) {
      for (const [_matchFrame, events] of net.remoteEvents) {
        for (const event of events) {
          injectEvent(event.eventType, event.payload, true);
        }
      }
    } else {
      if (hasNewConfirmFrames(frame)) {
        doRollback(frame);
      }
    }
    sendPacket(frame);
  } catch (e) {
    console.error("Error in beforeFrame:", e);
  }
});

/** Process incoming packets and update net state */
function receivePackets(frame: number) {
  const now = Date.now();

  // Update time since last packet for all peers
  for (const peer of connectedPeers) {
    const stats = peerStats.get(peer.id);
    if (stats && stats.lastPacketTime > 0) {
      stats.timeSinceLastPacket = now - stats.lastPacketTime;
    }
  }

  // Process incoming packets
  for (const [peerId, pkts] of packets) {
    const peer = connectedPeers.find((p) => p.id === peerId);
    if (!peer) {
      console.warn(
        `[netcode] Received packet from unknown peer: ${peerId}, total peers: ${connectedPeers.length}`,
      );
    }

    for (const packetBuffer of pkts) {
      const packet = decodeInputPacket(packetBuffer);
      if (!packet) {
        console.warn(`[netcode] Failed to decode packet from ${peerId}`);
        continue;
      }

      // Update the latest seq we've received (we'll send this back as our ack)
      if (packet.seq > net.remoteSeq) {
        net.remoteSeq = packet.seq;
      }

      // Update peer stats
      const stats = peerStats.get(peerId);
      if (stats) {
        stats.currentSeq = packet.seq;
        stats.currentAck = packet.ack;

        // Track packet timestamps for rate calculation (keep last 60 seconds)
        const cutoff = now - 60000;
        stats.packetTimestamps = stats.packetTimestamps.filter(
          (t) => t > cutoff,
        );
        stats.packetTimestamps.push(now);
        stats.packetsPerSecond = stats.packetTimestamps.length / 60;

        // Calculate average delta
        if (stats.packetTimestamps.length > 1) {
          const deltas: number[] = [];
          const timestamps = stats.packetTimestamps;
          for (let i = 1; i < timestamps.length; i++) {
            const current = timestamps[i];
            const previous = timestamps[i - 1];
            if (current !== undefined && previous !== undefined) {
              deltas.push(current - previous);
            }
          }
          if (deltas.length > 0) {
            stats.averagePacketDelta =
              deltas.reduce((a, b) => a + b, 0) / deltas.length;
          }
        }

        stats.lastPacketTime = now;
        stats.timeSinceLastPacket = 0;
      }

      // Process ack - remove events that have been confirmed received
      if (packet.ack >= 0) {
        for (const [eventFrame, _] of net.unackedEvents) {
          net.unackedEvents.delete(eventFrame);
        }
      }

      // Update latest remote frame from packet's match frame
      if (packet.matchFrame > net.latestRemoteFrame) {
        net.latestRemoteFrame = packet.matchFrame;
      }

      // Store remote events by their match frame for rollback
      for (const event of packet.events) {
        if (!net.remoteEvents.has(event.frame)) {
          net.remoteEvents.set(event.frame, []);
        }
        net.remoteEvents.get(event.frame)!.push(event);

        if (event.eventType === Enums.EventType.MouseDown) {
          logger.log({
            source: "rollback",
            label: `[REMOTE] MouseDown received for event.frame=${event.frame}, packet.matchFrame=${packet.matchFrame}, currentConfirmFrame=${net.confirmedState?.frame}`,
          });
        }
      }
    }
  }
  packets.clear();
}

function hasNewConfirmFrames(frame: number): boolean {
  if (net.confirmedState === null) {
    // still waiting to establish data connection
    console.warn(`Waiting to establish data connection...`);
    return false;
  }
  const currentMatchFrame =
    frame - Util.unwrap(net.sessionStartFrame, "Session has not started");
  const currentConfirmFrame = net.confirmedState.frame;
  const nextConfirmFrame = Math.min(net.latestRemoteFrame, currentMatchFrame);

  return nextConfirmFrame > currentConfirmFrame;
}

/** Perform rollback resimulation if we have new remote inputs to confirm */
function doRollback(frame: number) {
  if (net.confirmedState === null) {
    throw new Error("confirmedState is null");
  }

  const currentMatchFrame =
    frame - Util.unwrap(net.sessionStartFrame, "Session has not started");
  const currentConfirmFrame = net.confirmedState.frame;
  const nextConfirmFrame = Math.min(net.latestRemoteFrame, currentMatchFrame);
  const totalFramesToResim = nextConfirmFrame - currentConfirmFrame;

  const resimStart = performance.now();
  net.isResimulating = true;

  // Stash the current event buffer before rollback
  const eventsPtr = app.sim.wasm.get_events_ptr();
  const stashedEvents = new Uint8Array(app.sim.buffer, eventsPtr, 1540).slice();

  // Read current frame's events from buffer before rollback
  const currentFrameEvents = readEventsFromEngine(currentMatchFrame);
  if (
    currentFrameEvents.length > 0 &&
    !net.localEvents.has(currentMatchFrame)
  ) {
    net.localEvents.set(currentMatchFrame, currentFrameEvents);
  }

  try {
    // 1. Restore to last confirmed state
    app.sim.restore(net.confirmedState.snapshot);

    // 2. Resimulate confirmed frames (with both local + remote events)
    for (let f = net.confirmedState.frame + 1; f <= nextConfirmFrame; f++) {
      resimFrame(f, false);
    }

    // 3. Update confirmed state
    net.confirmedState = {
      frame: nextConfirmFrame,
      snapshot: app.sim.snapshot(),
    };

    // 4. Predict forward to current frame (local events only)
    for (let f = nextConfirmFrame + 1; f <= currentMatchFrame; f++) {
      resimFrame(f, true);
    }

    // Restore the stashed event buffer
    new Uint8Array(app.sim.buffer, eventsPtr, 1540).set(stashedEvents);

    const resimDuration = performance.now() - resimStart;
    if (resimDuration > 16) {
      console.warn(
        `[rollback] Resimulation took ${resimDuration.toFixed(
          2,
        )}ms (>16ms frame budget) for ${totalFramesToResim} frames`,
      );
    }
  } finally {
    net.isResimulating = false;
  }
}

/** Resimulate a single frame during rollback */
function resimFrame(f: number, isPrediction: boolean) {
  // Inject local events
  const localFrameEvents = net.localEvents.get(f) || [];
  for (const event of localFrameEvents) {
    if (event.eventType === Enums.EventType.MouseDown) {
      logger.log({
        source: "rollback",
        label: `[${
          isPrediction ? "PREDICT" : "CONFIRM"
        }] Injecting LOCAL MouseDown at resimFrame=${f}`,
      });
    }
    if (
      event.eventType === Enums.EventType.KeyDown &&
      event.payload[0] === Enums.Key.KeyL
    ) {
      logger.log({
        source: "rollback",
        label: `[${
          isPrediction ? "PREDICT" : "CONFIRM"
        }] Injecting LOCAL KeyL at resimFrame=${f}`,
      });
    }
    injectEvent(event.eventType, event.payload, false);
  }

  // Inject remote events (only during confirm phase)
  const remoteFrameEvents = net.remoteEvents.get(f) || [];
  for (const event of remoteFrameEvents) {
    if (event.eventType === Enums.EventType.MouseDown) {
      logger.log({
        source: "rollback",
        label: `[${
          isPrediction ? "PREDICT" : "CONFIRM"
        }] Injecting REMOTE MouseDown (as KeyL) at resimFrame=${f}`,
      });
    }
    injectEvent(event.eventType, event.payload, !isPrediction);
  }

  app.sim.tick();
}

/** Send packet with local events to remote peer */
function sendPacket(frame: number) {
  if (!udp || net.sessionStartFrame === null) {
    return;
  }

  const matchFrame = frame - net.sessionStartFrame;
  const frameEvents = readEventsFromEngine(matchFrame);

  if (frameEvents.length > 0) {
    net.unackedEvents.set(matchFrame, frameEvents);
    if (!net.localEvents.has(matchFrame)) {
      net.localEvents.set(matchFrame, []);
    }
    net.localEvents.get(matchFrame)!.push(...frameEvents);

    for (const event of frameEvents) {
      if (event.eventType === Enums.EventType.MouseDown) {
        logger.log({
          source: "rollback",
          label: `[LOCAL] MouseDown captured at matchFrame=${matchFrame}`,
        });
      }
    }
  }

  const allUnackedEvents: InputEvent[] = [];
  for (const events of net.unackedEvents.values()) {
    allUnackedEvents.push(...events);
  }

  const packet = encodeInputPacket({
    type: PacketType.Inputs,
    ack: net.remoteSeq,
    seq: net.nextSeq++,
    matchFrame,
    events: allUnackedEvents,
  });

  if (artificialLag > 0) {
    setTimeout(() => udp.send(packet), artificialLag);
  } else {
    udp.send(packet);
  }
}

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

// Helper to inject an event into the engine
// isRemote: true if this event came from another player
function injectEvent(
  eventType: number,
  payload: Uint8Array,
  isRemote: boolean,
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
        payload.byteLength,
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
        "KeyDown payload missing keyCode",
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
        "MouseDown payload missing buttonCode",
      );
      app.sim.wasm.emit_mousedown(buttonCode);
      break;
    }
    case Enums.EventType.MouseUp: {
      const buttonCode = Util.unwrap(
        payload[0],
        "MouseUp payload missing buttonCode",
      );
      app.sim.wasm.emit_mouseup(buttonCode);
      break;
    }
    case Enums.EventType.MouseMove: {
      const dv = new DataView(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength,
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
        payload.byteLength,
      );
      const deltaX = dv.getFloat32(0, true);
      const deltaY = dv.getFloat32(4, true);
      app.sim.wasm.emit_mousewheel(deltaX, deltaY);
      break;
    }
  }
}

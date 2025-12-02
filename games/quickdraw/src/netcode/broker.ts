import { WebSocket } from "partysocket";
import type { Logger } from "./logs";
import type { BrokerMessage } from "./protocol";
import {
  connect,
  listenForOffers,
  logErrors,
  logPeerConnection,
  type WebRtcPipe,
} from "./transport";

const remoteWsUrl = "wss://webrtc-divine-glade-8064.fly.dev/ws";
const localWsUrl = "ws://localhost:3000";

export type RoomEvents = {
  onBrokerMessage: (message: BrokerMessage) => void;
  onPeerIdAssign: (peerId: string) => void;
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string) => void;

  onDataChannelOpen: (
    peerId: string,
    reliable: boolean,
    channel: RTCDataChannel
  ) => void;
  onMessage: (peerId: string, data: Uint8Array, reliable: boolean) => void;
  onDataChannelClose: (peerId: string, reliable: boolean) => void;
};

export function joinRoom(_roomId: string, console: Logger, cbs: RoomEvents) {
  const broker = new WebSocket(remoteWsUrl);

  broker.addEventListener("open", () => {
    console.log({
      source: "ws",
      label: "Connection opened",
    });
  });

  broker.addEventListener("close", (event) => {
    console.warn({
      source: "ws",
      label: "Connection closed",
      json: event,
    });
  });

  broker.addEventListener("error", (event) => {
    console.error({
      source: "ws",
      label: "Connection error",
      json: event,
    });
  });

  const pipes: Map<string, WebRtcPipe> = new Map();

  let ourId = "";

  broker.addEventListener("message", async (event) => {
    try {
      const envelope = JSON.parse(event.data) as BrokerMessage;
      console.log({
        source: "ws",
        direction: "inbound",
        json: envelope,
      });

      switch (envelope.type) {
        case "welcome":
          ourId = envelope.yourId;
          cbs.onPeerIdAssign(envelope.yourId);
          for (const peerId of envelope.peerIds) {
            if (peerId === ourId) continue;
            cbs.onPeerConnected(peerId);
          }
          break;
        case "message:json":
          break;
        case "peer:connect": {
          const pipe = await connect(broker, envelope.peerId);
          registerPipe(pipe, cbs);
          cbs.onPeerConnected(envelope.peerId);
          break;
        }
        case "peer:disconnect":
          cbs.onPeerDisconnected(envelope.peerId);
          break;
        default:
          console.warn({
            source: "ws",
            label: `Unknown message type: ${envelope.type}`,
            json: envelope,
          });
      }
    } catch (e) {
      console.error({
        source: "ws",
        label: "Failed to parse json",
        json: {
          data: event.data,
          error: e,
        },
      });
    }
  });

  listenForOffers(broker, (pipe) => {
    registerPipe(pipe, cbs);
  });

  function registerPipe(pipe: WebRtcPipe, cbs: RoomEvents) {
    logErrors(pipe.reliable);
    logErrors(pipe.unreliable);
    logPeerConnection(pipe.peerConnection, ourId);

    cbs.onDataChannelOpen(pipe.peerId, true, pipe.reliable);
    cbs.onDataChannelOpen(pipe.peerId, false, pipe.unreliable);

    pipe.reliable.onmessage = (event) => {
      cbs.onMessage(pipe.peerId, event.data, true);
    };
    pipe.reliable.onclose = () => {
      cbs.onDataChannelClose(pipe.peerId, true);
    };

    pipe.unreliable.onmessage = (event) => {
      cbs.onMessage(pipe.peerId, event.data, false);
    };
    pipe.unreliable.onclose = () => {
      cbs.onDataChannelClose(pipe.peerId, false);
    };
    pipes.set(pipe.peerId, pipe);
  }
}

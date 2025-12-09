import type { WebSocket } from "partysocket";
import { logger } from "./logs.ts";
import type { BrokerMessage, PeerMessage } from "./protocol.ts";

const iceServers: RTCConfiguration["iceServers"] = [
  { urls: "stun:stun.cloudflare.com:3478" },
];

export type WebRtcPipe = {
  peerConnection: RTCPeerConnection;
  reliable: RTCDataChannel;
  unreliable: RTCDataChannel;
  peerId: string;
};

export async function connect(
  ws: WebSocket,
  peerId: string,
  /** defaults to 10s */
  timeoutMs: number = 10000,
): Promise<WebRtcPipe> {
  const pc = new RTCPeerConnection({ iceServers });
  const reliable = pc.createDataChannel("reliable", {});
  const unreliable = pc.createDataChannel("unreliable", {
    ordered: false,
    maxRetransmits: 0,
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  logger.log({ source: "webrtc", label: "set local description with offer" });
  await gatherIce(pc, timeoutMs);
  logger.log({ source: "webrtc", label: "gathered ICE candidates" });
  send(ws, {
    type: "offer",
    payload: btoa(JSON.stringify(pc.localDescription)),
    target: peerId,
  });
  await waitForAnswer(ws, pc, timeoutMs);

  return {
    peerConnection: pc,
    reliable,
    unreliable,
    peerId,
  };
}

export async function logErrors(dc: RTCDataChannel) {
  // TODO: handle errors and disconnects in example game
  dc.onerror = (event) => {
    logger.error({
      source: "webrtc",
      label: `[${dc.label}] error`,
      json: event,
    });
  };

  dc.onclosing = (event) => {
    logger.log({
      source: "webrtc",
      label: `[${dc.label}] closing`,
      json: event,
    });
  };

  dc.onopen = (event) => {
    logger.log({
      source: "webrtc",
      label: `[${dc.label}] opened`,
      json: event,
    });
  };

  dc.onclose = (event) => {
    logger.log({
      source: "webrtc",
      label: `[${dc.label}] closed`,
      json: event,
    });
  };
}

export async function logPeerConnection(pc: RTCPeerConnection, peerId: string) {
  pc.onconnectionstatechange = () => {
    logger.log({
      source: "webrtc",
      label: `[pc ${peerId}}] connectionState = ${pc.connectionState}`,
    });
  };
}

export async function gatherIce(
  pc: RTCPeerConnection,
  timeoutMs: number,
): Promise<boolean | Error> {
  return new Promise<boolean | Error>((yes, no) => {
    setTimeout(
      () => no(new Error("Timed out waiting for completion")),
      timeoutMs,
    );

    pc.onicegatheringstatechange = () => {
      logger.log({
        source: "webrtc",
        label: `icegatheringstatechange: ${pc.iceGatheringState}`,
      });

      if (pc.iceGatheringState === "complete") {
        yes(true);
      }
    };
  });
}

export async function waitForAnswer(
  ws: WebSocket,
  pc: RTCPeerConnection,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((yes, no) => {
    const timeoutId = setTimeout(no, timeoutMs);
    const messageListener = async (event: MessageEvent) => {
      const serverMsg: BrokerMessage = JSON.parse(event.data);
      if (serverMsg.type !== "message:json") {
        return;
      }
      const peerMsg = serverMsg.message;
      if (peerMsg.type !== "answer") {
        return;
      }
      logger.log({ source: "webrtc", label: "received answer from peer" });
      const answerDesc = JSON.parse(atob(peerMsg.payload));
      await pc.setRemoteDescription(new RTCSessionDescription(answerDesc));
      logger.log({
        source: "webrtc",
        label: "set remote description with answer",
      });
      clearTimeout(timeoutId);
      yes();
    };
    ws.addEventListener("message", messageListener);
  });
}

export function listenForOffers(ws: WebSocket, cb: (pipe: WebRtcPipe) => void) {
  const messageListener = async (event: MessageEvent) => {
    const envelope: BrokerMessage = JSON.parse(event.data);
    if (envelope.type !== "message:json") {
      return;
    }
    const msg = envelope.message;
    if (msg.type !== "offer") {
      return;
    }
    logger.log({ source: "webrtc", label: "received offer" });
    const offer = JSON.parse(atob(msg.payload));
    const pc = new RTCPeerConnection({ iceServers });

    const gatherIcePromise = gatherIce(pc, 10000);

    await pc.setRemoteDescription(offer);
    logger.log({ source: "webrtc", label: "set remote description" });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    logger.log({ source: "webrtc", label: "set local description" });
    await gatherIcePromise;

    const channels = {
      reliable: null as RTCDataChannel | null,
      unreliable: null as RTCDataChannel | null,
    };

    pc.ondatachannel = (event) => {
      logger.log({
        source: "webrtc",
        label: `received datachannel ${event.channel.label}`,
      });
      switch (event.channel.label) {
        case "reliable":
          channels.reliable = event.channel;
          break;
        case "unreliable":
          channels.unreliable = event.channel;
          break;
      }
      if (channels.reliable && channels.unreliable) {
        pc.ondatachannel = null;
        cb({
          peerConnection: pc,
          reliable: channels.reliable,
          unreliable: channels.unreliable,
          peerId: envelope.peerId,
        });
      }
    };

    send(ws, {
      type: "answer",
      payload: btoa(JSON.stringify(answer)),
      target: envelope.peerId,
    });
  };

  ws.addEventListener("message", messageListener);
}

function send(ws: WebSocket, msg: PeerMessage) {
  ws.send(JSON.stringify(msg));
  logger.log({ source: "ws", direction: "outbound", json: msg });
}

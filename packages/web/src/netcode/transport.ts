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
  logger.log({ source: "webrtc", label: "set offer", json: offer });
  await gatherIce(pc, timeoutMs);
  logger.log({ source: "webrtc", label: "gathered ICE candidates" });

  logger.log({
    source: "ws",
    label: "sending local description",
    json: pc.localDescription,
    to: peerId,
  });
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
  dc.onerror = (event) => {
    logger.error({
      source: "webrtc",
      label: `error on ${dc.label} channel`,
      json: event.error,
    });
  };

  dc.onclosing = (_event) => {
    logger.log({
      source: "webrtc",
      label: `closing ${dc.label} channel`,
    });
  };

  dc.onopen = (_event) => {
    logger.log({
      source: "webrtc",
      label: `opened ${dc.label} channel`,
    });
  };

  dc.onclose = (_event) => {
    logger.log({
      source: "webrtc",
      label: `closed ${dc.label} channel`,
    });
  };
}

export async function logPeerConnection(pc: RTCPeerConnection, peerId: string) {
  pc.onconnectionstatechange = () => {
    logger.log({
      source: "webrtc",
      label: `[${peerId.substring(0, 6)}] connectionState = ${pc.connectionState}`,
    });
  };

  pc.onsignalingstatechange = () => {
    logger.log({
      source: "webrtc",
      label: `[${peerId.substring(0, 6)}] signalingState = ${pc.signalingState}`,
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
      const answerDesc = JSON.parse(atob(peerMsg.payload));
      logger.log({
        source: "webrtc",
        label: "received answer",
        json: answerDesc,
      });
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

    await pc.setRemoteDescription(offer);
    logger.log({
      source: "webrtc",
      label: "set remote description",
      json: { offer, remoteDescription: pc.remoteDescription },
    });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    logger.log({
      source: "webrtc",
      label: "set local description",
      json: pc.localDescription,
    });
    await gatherIce(pc, 10000);

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

    logger.log({
      source: "webrtc",
      label: "sending answer",
      json: pc.localDescription,
    });

    send(ws, {
      type: "answer",
      payload: btoa(JSON.stringify(pc.localDescription)),
      target: envelope.peerId,
    });
  };

  ws.addEventListener("message", messageListener);
}

function send(ws: WebSocket, msg: PeerMessage) {
  ws.send(JSON.stringify(msg));
  logger.log({ source: "ws", direction: "outbound", json: msg });
}

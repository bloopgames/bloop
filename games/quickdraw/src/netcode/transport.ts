import type { WebSocket } from "partysocket";
import type { BrokerMessage, PeerMessage } from "./protocol";

export const netcode = {
  logWs(...args: any[]) {
    console.log("[ws]", ...args);
  },
  logRtc(...args: any[]) {
    console.log("[rtc]", ...args);
  },
};

const iceServers: RTCConfiguration["iceServers"] = [
  { urls: "stun:stun.cloudflare.com:3478" },
];

// const remoteWsUrl = "wss://webrtc-divine-glade-8064.fly.dev/ws";
// const localWsUrl = "ws://localhost:3000";

// const ws = new WebSocket(remoteWsUrl);

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
  timeoutMs: number = 10000
): Promise<WebRtcPipe> {
  const pc = new RTCPeerConnection({ iceServers });
  const reliable = pc.createDataChannel("reliable", {});
  const unreliable = pc.createDataChannel("unreliable", {
    ordered: false,
    maxRetransmits: 0,
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  netcode.logRtc("set local description with offer");
  await gatherIce(pc, timeoutMs);
  netcode.logRtc("gathered ICE candidates");
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
    netcode.logRtc(`[${dc.label}] ${JSON.stringify(event)}`);
  };

  dc.onclosing = (event) => {
    netcode.logRtc(`[${dc.label}] closing: ${JSON.stringify(event)}`);
  };

  dc.onopen = (event) => {
    netcode.logRtc(`[${dc.label}] opened: ${JSON.stringify(event)}`);
  };

  dc.onclose = (event) => {
    netcode.logRtc(`[${dc.label}] closed: ${JSON.stringify(event)}`);
  };
}

export async function logPeerConnection(pc: RTCPeerConnection, peerId: string) {
  pc.onconnectionstatechange = () => {
    netcode.logRtc(`[pc ${peerId}] connectionState = ${pc.connectionState}`);
  };
}

export async function gatherIce(
  pc: RTCPeerConnection,
  timeoutMs: number
): Promise<boolean | Error> {
  return new Promise<boolean | Error>((yes, no) => {
    setTimeout(
      () => no(new Error("Timed out waiting for completion")),
      timeoutMs
    );

    pc.onicegatheringstatechange = () => {
      netcode.logRtc(`icegatheringstatechange: ${pc.iceGatheringState}`);

      if (pc.iceGatheringState === "complete") {
        yes(true);
      }
    };
  });
}

export async function waitForAnswer(
  ws: WebSocket,
  pc: RTCPeerConnection,
  timeoutMs: number
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
      netcode.logRtc("received answer from peer");
      const answerDesc = JSON.parse(atob(peerMsg.payload));
      await pc.setRemoteDescription(new RTCSessionDescription(answerDesc));
      netcode.logRtc("set remote description with answer");
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
    netcode.logRtc("received offer");
    const offer = JSON.parse(atob(msg.payload));
    const pc = new RTCPeerConnection({ iceServers });

    const gatherIcePromise = gatherIce(pc, 10000);

    await pc.setRemoteDescription(offer);
    netcode.logRtc("set remote description");
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    netcode.logRtc("set local description");
    await gatherIcePromise;

    const channels = {
      reliable: null as RTCDataChannel | null,
      unreliable: null as RTCDataChannel | null,
    };

    pc.ondatachannel = (event) => {
      netcode.logRtc(`[rtc.pc] received datachannel ${event.channel.label}`);
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
  console.log("[ws out]", msg);
}

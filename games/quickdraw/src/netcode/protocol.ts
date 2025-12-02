export type PeerId = string;

export type BrokerMessage =
  | {
      type: "welcome";
      yourId: PeerId;
      peerIds: PeerId[];
      serverId: string;
    }
  | {
      type: "message:json";
      peerId: PeerId;
      message: PeerMessage;
    }
  | {
      type: "message:string";
      peerId: PeerId;
      message: string;
    }
  | {
      type: "message:buffer";
      peerId: PeerId;
      message: ArrayBuffer;
    }
  | {
      type: "peer:connect";
      peerId: PeerId;
    }
  | {
      type: "peer:disconnect";
      peerId: PeerId;
    };

export type PeerMessage =
  | {
      type: "offer";
      target: string;
      payload: string;
    }
  | {
      type: "answer";
      target: string;
      payload: string;
    }
  | {
      type: "message";
      payload: any;
    };

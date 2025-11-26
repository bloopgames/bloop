export type BrokerMessage =
  | {
      type: "welcome";
      yourId: string;
      peerIds: string[];
      serverId: string;
    }
  | {
      type: "message:json";
      peerId: string;
      message: PeerMessage;
    }
  | {
      type: "message:string";
      peerId: string;
      message: string;
    }
  | {
      type: "message:buffer";
      peerId: string;
      message: ArrayBuffer;
    }
  | {
      type: "peer:connect";
      peerId: string;
    }
  | {
      type: "peer:disconnect";
      peerId: string;
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

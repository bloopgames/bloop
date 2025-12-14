import { describe, expect, it, beforeEach } from "bun:test";
import {
  debugState,
  addLog,
  addPeer,
  updatePeer,
  removePeer,
  setLocalId,
  setRemoteId,
  clearLogs,
  resetState,
  cycleLayout,
  type Peer,
  type LayoutMode,
} from "../../src/debugui/state.ts";

describe("debugui state", () => {
  beforeEach(() => {
    resetState();
  });

  describe("layoutMode and isVisible", () => {
    it("starts as off", () => {
      expect(debugState.layoutMode.value).toBe("off");
      expect(debugState.isVisible.value).toBe(false);
    });

    it("cycles through modes: off -> letterboxed -> full -> off", () => {
      expect(debugState.layoutMode.value).toBe("off");
      expect(debugState.isVisible.value).toBe(false);

      cycleLayout();
      expect(debugState.layoutMode.value).toBe("letterboxed");
      expect(debugState.isVisible.value).toBe(true);

      cycleLayout();
      expect(debugState.layoutMode.value).toBe("full");
      expect(debugState.isVisible.value).toBe(true);

      cycleLayout();
      expect(debugState.layoutMode.value).toBe("off");
      expect(debugState.isVisible.value).toBe(false);
    });
  });

  describe("logs", () => {
    it("starts empty", () => {
      expect(debugState.logs.value).toHaveLength(0);
    });

    it("adds logs correctly", () => {
      addLog({
        source: "local",
        frame_number: 1,
        match_frame: null,
        timestamp: Date.now(),
        severity: "log",
        label: "test log",
      });

      expect(debugState.logs.value).toHaveLength(1);
      expect(debugState.logs.value[0]!.label).toBe("test log");
    });

    it("clears logs", () => {
      addLog({
        source: "local",
        frame_number: 1,
        match_frame: null,
        timestamp: Date.now(),
        severity: "log",
      });
      addLog({
        source: "webrtc",
        frame_number: 2,
        match_frame: null,
        timestamp: Date.now(),
        severity: "log",
      });

      expect(debugState.logs.value).toHaveLength(2);
      clearLogs();
      expect(debugState.logs.value).toHaveLength(0);
    });
  });

  describe("peers", () => {
    const testPeer: Peer = {
      id: "peer1",
      nickname: "Player 1",
      ack: 0,
      seq: 0,
      lastPacketTime: 0,
    };

    it("starts with empty peers", () => {
      expect(debugState.netStatus.value.peers).toHaveLength(0);
    });

    it("adds peer correctly", () => {
      addPeer(testPeer);
      expect(debugState.netStatus.value.peers).toHaveLength(1);
      expect(debugState.netStatus.value.peers[0]!.id).toBe("peer1");
    });

    it("updates peer correctly", () => {
      addPeer(testPeer);
      updatePeer("peer1", { seq: 5, ack: 3 });

      expect(debugState.netStatus.value.peers[0]!.seq).toBe(5);
      expect(debugState.netStatus.value.peers[0]!.ack).toBe(3);
      expect(debugState.netStatus.value.peers[0]!.nickname).toBe("Player 1");
    });

    it("removes peer correctly", () => {
      addPeer(testPeer);
      addPeer({ ...testPeer, id: "peer2", nickname: "Player 2" });

      expect(debugState.netStatus.value.peers).toHaveLength(2);
      removePeer("peer1");
      expect(debugState.netStatus.value.peers).toHaveLength(1);
      expect(debugState.netStatus.value.peers[0]!.id).toBe("peer2");
    });
  });

  describe("computed values", () => {
    it("computes peer from first peer in list", () => {
      expect(debugState.peer.value).toBeNull();

      addPeer({
        id: "peer1",
        nickname: "Player 1",
        ack: 10,
        seq: 15,
        lastPacketTime: 0,
      });

      expect(debugState.peer.value).not.toBeNull();
      expect(debugState.peer.value?.nickname).toBe("Player 1");
    });

    it("computes advantage correctly", () => {
      expect(debugState.advantage.value).toBeNull();

      addPeer({
        id: "peer1",
        nickname: "Player 1",
        ack: 10,
        seq: 15,
        lastPacketTime: 0,
      });

      expect(debugState.advantage.value).toBe(5);
    });
  });

  describe("local/remote IDs", () => {
    it("sets local ID", () => {
      expect(debugState.netStatus.value.ourId).toBeNull();
      setLocalId(0);
      expect(debugState.netStatus.value.ourId).toBe(0);
    });

    it("sets remote ID", () => {
      expect(debugState.netStatus.value.remoteId).toBeNull();
      setRemoteId(1);
      expect(debugState.netStatus.value.remoteId).toBe(1);
    });
  });

  describe("resetState", () => {
    it("resets all state to initial values", () => {
      debugState.layoutMode.value = "letterboxed";
      addLog({
        source: "local",
        frame_number: 1,
        match_frame: null,
        timestamp: Date.now(),
        severity: "log",
      });
      addPeer({
        id: "peer1",
        nickname: "Player 1",
        ack: 0,
        seq: 0,
        lastPacketTime: 0,
      });
      setLocalId(0);
      setRemoteId(1);

      resetState();

      expect(debugState.layoutMode.value as LayoutMode).toBe("off");
      expect(debugState.isVisible.value).toBe(false);
      expect(debugState.logs.value).toHaveLength(0);
      expect(debugState.netStatus.value.peers).toHaveLength(0);
      expect(debugState.netStatus.value.ourId).toBeNull();
      expect(debugState.netStatus.value.remoteId).toBeNull();
    });
  });
});

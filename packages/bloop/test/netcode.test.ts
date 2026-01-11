import { describe, expect, it } from "bun:test";
import { assert, Bloop, mount, unwrap } from "../src/mod";
import { loadTape, startOnlineMatch } from "./helper";

describe("netcode integration", () => {
  it("should route remote peer events to correct player", async () => {
    const [sim0, sim1, game0, game1] = await startOnlineMatch(() => {
      const game = Bloop.create({ bag: { p0Clicks: 0, p1Clicks: 0 } });
      game.system("clicks", {
        update({ bag, players }) {
          if (players.get(0).mouse.left.down) bag.p0Clicks++;
          if (players.get(1).mouse.left.down) bag.p1Clicks++;
        },
      });
      return game;
    });

    // Step both sims to start
    sim0.step();
    sim1.step();

    // Peer 0 clicks - should register as player 0
    sim0.emit.mousedown("Left", 0);
    sim0.step();

    expect(game0.bag.p0Clicks).toBe(1);
    expect(game0.bag.p1Clicks).toBe(0);

    // Get packet from sim0 to send to sim1
    const packet0 = sim0.getOutboundPacket(1);
    assert(packet0, "Packet from sim0 to sim1 should not be null");
    expect(packet0.length).toBeGreaterThan(0);

    // sim1 receives the packet
    sim1.emit.packet(packet0);
    sim1.step();

    // On sim1, the remote event from peer 0 should be routed to player 0
    expect(game1.bag.p0Clicks).toBe(1);
    expect(game1.bag.p1Clicks).toBe(0);
  });

  it("should handle peer 1 sending to peer 0", async () => {
    const [sim0, sim1, game0, game1] = await startOnlineMatch(() => {
      const game = Bloop.create({ bag: { p0Clicks: 0, p1Clicks: 0 } });
      game.system("clicks", {
        update({ bag, players }) {
          if (players.get(0).mouse.left.down) bag.p0Clicks++;
          if (players.get(1).mouse.left.down) bag.p1Clicks++;
        },
      });
      return game;
    });

    // Peer 1 clicks - should register as player 1 locally
    sim1.emit.mousedown("Left", 1);
    sim1.step();

    expect(game1.bag.p0Clicks).toBe(0);
    expect(game1.bag.p1Clicks).toBe(1);

    // Get packet from sim1 to send to sim0
    const packet1 = sim1.getOutboundPacket(0);
    assert(packet1, "Packet from sim1 to sim0 should not be null");
    expect(packet1.length).toBeGreaterThan(0);

    // sim0 receives the packet
    sim0.emit.packet(packet1);
    sim0.step();

    // On sim0, the remote event from peer 1 should be routed to player 1
    expect(game0.bag.p0Clicks).toBe(0);
    expect(game0.bag.p1Clicks).toBe(1);
  });

  it("regress: processes two events on the same frame through a rollback session", async () => {
    const [sim0, sim1, game0, game1] = await startOnlineMatch(() => {
      const game = Bloop.create({ bag: { aCount: 0, bCount: 0 } });
      game.system("track-keys", {
        update({ bag, players }) {
          if (players.get(0).keys.a.down) bag.aCount++;
          if (players.get(0).keys.b.down) bag.bCount++;
        },
      });
      return game;
    });

    // Emit both keydown and keyup before stepping (same frame)
    sim0.emit.keydown("KeyA", 0);
    sim0.emit.keydown("KeyB", 0);
    sim0.step();
    sim1.step();

    // Both events should be processed during prediction
    expect(game0.bag.aCount).toBe(1);
    expect(game0.bag.bCount).toBe(1);

    // send and receive packets to trigger rollback
    const packet = sim0.getOutboundPacket(1);
    assert(packet);
    sim1.emit.packet(packet);
    const packet1 = sim1.getOutboundPacket(0);
    assert(packet1);
    sim0.emit.packet(packet1);

    sim0.step();
    sim1.step();

    expect(game0.bag.bCount).toEqual(1);
    expect(game0.bag.aCount).toEqual(1);
    expect(game1.bag.bCount).toEqual(1);
    expect(game1.bag.aCount).toEqual(1);
  });

  it("regress: handles net.isInSession context correctly for local", async () => {
    const game = Bloop.create({
      bag: { count: 0, inSession: false as boolean },
    });
    game.system("halp", {
      update({ bag, net }) {
        bag.count++;
        bag.inSession = net.isInSession;
      },
    });

    const { sim } = await mount(game);

    sim.step();

    expect(game.bag.count).toEqual(1);
    expect(game.bag.inSession).toEqual(false);
  });

  it("can connect via room code", async () => {
    const game0 = Bloop.create({
      bag: {
        events: [] as [string, any][],
      },
    });
    const game1 = Bloop.create();

    game0.system("netcode", {
      update({ net }) {
        if (net.status === "local") {
          net.wantsRoomCode = "TEST";
        }
      },

      netcode({ event }) {
        game0.bag.events.push([event.type, event.data]);
      },
    });

    game1.system("netcode", {
      keydown({ event, net }) {
        if (event.key === "Enter") {
          net.wantsRoomCode = "TEST";
        }
      },
    });

    const { sim: sim0 } = await mount(game0);
    const { sim: sim1 } = await mount(game1);

    sim0.step();
    expect(sim0.net.wantsRoomCode).toEqual("TEST");
    sim0.emit.network("join:ok", { roomCode: "TEST" });
    sim0.step();
    expect(game0.context.net.roomCode).toEqual("TEST");

    expect(sim1.net.wantsRoomCode).toBeUndefined();
    sim1.emit.keydown("Enter");
    sim1.step();
    expect(sim1.net.wantsRoomCode).toEqual("TEST");
    sim1.emit.network("join:ok", { roomCode: "TEST" });
    sim0.emit.network("peer:join", { peerId: 1 });
    sim1.emit.network("peer:join", { peerId: 0 });
    expect(sim1.net.roomCode).toEqual("");
    sim1.step();
    expect(sim1.net.roomCode).toEqual("TEST");

    sim0.step();

    expect(game0.context.net.isInSession).toEqual(true);
    expect(game1.context.net.isInSession).toEqual(true);

    expect(game0.context.net.peerCount).toEqual(2);
    expect(game1.context.net.peerCount).toEqual(2);

    expect(game0.bag.events[0]![0]).toEqual("join:ok");
    expect(game0.bag.events[0]![1]).toEqual({ roomCode: "TEST" });

    expect(game0.bag.events[1]![0]).toEqual("peer:join");
    expect(game0.bag.events[1]![1]).toEqual({ peerId: 1 });
  });

  it("maintains peer data", async () => {
    const [sim0, sim1, game0, game1] = await startOnlineMatch(() => {
      const game = Bloop.create({
        bag: {
          local: { ack: -2, seq: -2 },
          remote: { ack: -2, seq: -2 },
        },
      });

      game.system("track-peers", {
        update({ bag, net }) {
          for (const peer of net.peers) {
            if (peer.isLocal) {
              bag.local = { ack: peer.ack, seq: peer.seq };
            } else {
              bag.remote = { ack: peer.ack, seq: peer.seq };
            }
          }
        },
      });
      return game;
    });

    // After startOnlineMatch, one tick has run (match_frame 0), and matchFrame is now 1.
    // The bag stores values from the tick at match_frame 0.
    const matchFrame = game0.context.net.matchFrame;
    expect(matchFrame).toEqual(1);

    // bag.local.seq is the matchFrame during tick = matchFrame - 1
    expect(game0.bag.local.seq).toEqual(matchFrame - 1);
    expect(game0.bag.local.ack).toEqual(-1);
    expect(game0.bag.remote.seq).toEqual(-1);
    expect(game0.bag.remote.ack).toEqual(-1);

    // Packets are built with the current matchFrame value
    const packet0 = unwrap(
      sim1.getOutboundPacket(0),
      "peer 1 to peer 0 has no packet",
    );
    const packet1 = unwrap(
      sim0.getOutboundPacket(1),
      "peer 0 to peer 1 has no packet",
    );

    // 2-frame delay before we receive the first packet.
    // Our local seq should advance (bag stores matchFrame - 1 from the tick)
    sim0.step();
    sim1.step();
    sim0.step();
    sim1.step();
    expect(game0.bag.local.seq).toEqual(matchFrame + 2 - 1);
    expect(game0.bag.local.ack).toEqual(-1);
    expect(game0.bag.remote.seq).toEqual(-1);
    expect(game0.bag.remote.ack).toEqual(-1);

    // When we receive the packet from the first match frame, it should update our ack and their seq
    sim0.emit.packet(packet0);
    sim1.emit.packet(packet1);
    sim0.step();
    sim1.step();
    expect(game0.bag.local.seq).toEqual(matchFrame + 3 - 1);
    // ack = min(remote seqs) = remote.seq from packet = matchFrame (packet was built at matchFrame = 1)
    expect(game0.bag.local.ack).toEqual(matchFrame);
    expect(game0.bag.remote.seq).toEqual(matchFrame);
    expect(game0.bag.remote.ack).toEqual(-1);
    const receiveFrame = matchFrame + 3;

    // If we fast forward to when the packet arrives with an ack of our latest seq, it should
    // update the data correctly.
    const packet2_0 = unwrap(
      sim1.getOutboundPacket(0),
      "peer 1 to peer 0 has no packet",
    );
    const packet2_1 = unwrap(
      sim0.getOutboundPacket(1),
      "peer 0 to peer 1 has no packet",
    );
    sim0.step();
    sim1.step();
    sim0.step();
    sim1.step();
    sim0.emit.packet(packet2_0);
    sim1.emit.packet(packet2_1);
    sim0.step();
    sim1.step();
    expect(game0.bag.local.seq).toEqual(receiveFrame + 3 - 1);
    expect(game0.bag.local.ack).toEqual(receiveFrame);
    expect(game0.bag.remote.seq).toEqual(receiveFrame);
    expect(game0.bag.remote.ack).toEqual(matchFrame);
  });

  it('regress: doesnt enqueue duplicate "peer:join" events', async () => {
    // Track peer:join events by matchFrame - should see at most 2 per frame (one per peer)
    const peerJoins: number[] = [];

    const [sim0, sim1] = await startOnlineMatch(() => {
      const game = Bloop.create({});
      game.system("track-peer-joins", {
        netcode({ event }) {
          if (event.type === "peer:join") {
            peerJoins.push(event.data.peerId);
          }
        },
      });

      return game;
    });

    // Step once more so local peer's confirmed frame is tracked via sessionStep
    sim0.step();
    sim1.step();

    peerJoins.length = 0;
    const packet = unwrap(sim1.getOutboundPacket(0));
    sim0.emit.packet(packet);
    // trigger rollback
    sim0.step();

    // Each peer:join should fire exactly once during confirm frames
    // If we see 4 events instead of 2, the bug is present (events are duplicated from snapshot)
    expect(peerJoins.length).toEqual(2);
  });
});

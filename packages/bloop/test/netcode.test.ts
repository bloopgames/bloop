import { describe, expect, it } from "bun:test";
import { MAX_ROLLBACK_FRAMES } from "@bloopjs/engine";
import { assert, Bloop, mount, unwrap } from "../src/mod";
import { setupSession, stepBoth } from "./helper";

describe("netcode integration", () => {
  it("should route remote peer events to correct player", async () => {
    // Create two games representing two peers
    const game0 = Bloop.create({ bag: { p0Clicks: 0, p1Clicks: 0 } });
    const game1 = Bloop.create({ bag: { p0Clicks: 0, p1Clicks: 0 } });

    // Track clicks per player
    const clickSystem = {
      update({ bag, players }: { bag: typeof game0.bag; players: any[] }) {
        if (players[0]?.mouse.left.down) bag.p0Clicks++;
        if (players[1]?.mouse.left.down) bag.p1Clicks++;
      },
    };
    game0.system("clicks", clickSystem as any);
    game1.system("clicks", clickSystem as any);

    const { sim: sim0 } = await mount(game0);
    const { sim: sim1 } = await mount(game1);

    setupSession(sim0, sim1);

    // Step both sims to start
    sim0.step();
    sim1.step();

    // Peer 0 clicks - should register as player 0
    sim0.emit.mousedown("Left", 0);
    sim0.step();

    expect(game0.bag.p0Clicks).toBe(1);
    expect(game0.bag.p1Clicks).toBe(0);

    // Get packet from sim0 to send to sim1
    const packet0 = sim0.net.getOutboundPacket(1);
    assert(packet0, "Packet from sim0 to sim1 should not be null");
    expect(packet0.length).toBeGreaterThan(0);

    // sim1 receives the packet
    sim1.net.receivePacket(packet0);
    sim1.step();

    // On sim1, the remote event from peer 0 should be routed to player 0
    expect(game1.bag.p0Clicks).toBe(1);
    expect(game1.bag.p1Clicks).toBe(0);
  });

  it("should handle peer 1 sending to peer 0", async () => {
    const game0 = Bloop.create({ bag: { p0Clicks: 0, p1Clicks: 0 } });
    const game1 = Bloop.create({ bag: { p0Clicks: 0, p1Clicks: 0 } });

    const clickSystem = {
      update({ bag, players }: { bag: typeof game0.bag; players: any[] }) {
        if (players[0]?.mouse.left.down) bag.p0Clicks++;
        if (players[1]?.mouse.left.down) bag.p1Clicks++;
      },
    };
    game0.system("clicks", clickSystem as any);
    game1.system("clicks", clickSystem as any);

    const { sim: sim0 } = await mount(game0);
    const { sim: sim1 } = await mount(game1);

    setupSession(sim0, sim1);

    sim0.step();
    sim1.step();

    // Peer 1 clicks - should register as player 1 locally
    sim1.emit.mousedown("Left", 1);
    sim1.step();

    expect(game1.bag.p0Clicks).toBe(0);
    expect(game1.bag.p1Clicks).toBe(1);

    // Get packet from sim1 to send to sim0
    const packet1 = sim1.net.getOutboundPacket(0);
    assert(packet1, "Packet from sim1 to sim0 should not be null");
    expect(packet1.length).toBeGreaterThan(0);

    // sim0 receives the packet
    sim0.net.receivePacket(packet1);
    sim0.step();

    // On sim0, the remote event from peer 1 should be routed to player 1
    expect(game0.bag.p0Clicks).toBe(0);
    expect(game0.bag.p1Clicks).toBe(1);
  });

  // TODO: this test passed when it should have failed - see getUnackedFrame in net.zig
  it("regress: does not send stale events after ring buffer wrap", async () => {
    const receivedEvents = new Map<number, string>();

    const game0 = Bloop.create({ bag: {} });
    const game1 = Bloop.create({ bag: {} });
    game1.system("track", {
      keydown({ event, net }) {
        console.log("received event");
        receivedEvents.set(net.matchFrame, event.key);
      },
      update({ net, time }) {
        console.log("checking match frame", net.matchFrame, time.frame);
      },
    });

    const { sim: sim0 } = await mount(game0, { startRecording: false });
    const { sim: sim1 } = await mount(game1, { startRecording: false });

    // Setup session
    setupSession(sim0, sim1);

    // Frame 1: peer0 KeyA
    stepBoth(sim0, sim1);
    sim0.emit.keydown("KeyA", 0);
    sim0.step();

    const peerState = sim0.net.getPeerState(1);
    expect(peerState).toEqual({ seq: 0, ack: 0 });

    for (let i = 0; i < MAX_ROLLBACK_FRAMES + 10; i++) {
      // TODO: why does this cause changes in test behavior??
      // sim0.emit.mousemove(100, 100);
      sim1.net.receivePacket(unwrap(sim0.net.getOutboundPacket(1)));
      sim0.step();
    }

    for (let i = 0; i < MAX_ROLLBACK_FRAMES + 10; i++) {
      sim1.step();
    }

    // we should not receive the stale KeyA event on a future frame
    expect(receivedEvents.size).toEqual(1);
    expect(receivedEvents.get(1)).toEqual("KeyA");
  });

  it("regress: processes two events on the same frame through a rollback session", async () => {
    // If keydown and keyup happen on the same frame, both should be processed
    const game = Bloop.create({ bag: { aCount: 0, bCount: 0 } });
    game.system("track-keys", {
      update({ bag, players }) {
        if (players[0]?.keys.a.down) bag.aCount++;
        if (players[0]?.keys.b.down) bag.bCount++;
      },
    });

    const game1 = Bloop.create({ bag: { aCount: 0, bCount: 0 } });
    game1.system("track-keys", {
      update({ bag, players }) {
        if (players[0]?.keys.a.down) bag.aCount++;
        if (players[0]?.keys.b.down) bag.bCount++;
      },
    });

    const { sim: sim0 } = await mount(game, { startRecording: false });
    const { sim: sim1 } = await mount(game1, { startRecording: false });

    // Initialize session
    setupSession(sim0, sim1);
    sim0.sessionInit(2);
    sim0.net.setLocalPeer(0);
    sim0.net.connectPeer(1);
    sim1.sessionInit(2);
    sim1.net.setLocalPeer(1);
    sim1.net.connectPeer(0);

    // Emit both keydown and keyup before stepping (same frame)
    sim0.emit.keydown("KeyA", 0);
    sim0.emit.keydown("KeyB", 0);
    sim0.step();
    sim1.step();

    // Both events should be processed during prediction
    expect(game.bag.aCount).toBe(1);
    expect(game.bag.bCount).toBe(1);

    // send and receive packets to trigger rollback
    const packet = sim0.net.getOutboundPacket(1);
    assert(packet);
    sim1.net.receivePacket(packet);
    const packet1 = sim1.net.getOutboundPacket(0);
    assert(packet1);
    sim0.net.receivePacket(packet1);

    sim0.step();
    sim1.step();

    expect(game.bag.bCount).toEqual(1);
    expect(game.bag.aCount).toEqual(1);
    expect(game1.bag.bCount).toEqual(1);
    expect(game1.bag.aCount).toEqual(1);
  });
});

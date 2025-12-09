import { describe, expect, it } from "bun:test";
import { assert, Bloop, mount } from "../src/mod";

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

    // Initialize sessions - peer 0 on sim0, peer 1 on sim1
    sim0.sessionInit(2);
    sim0.net.setLocalPeer(0);
    sim0.net.connectPeer(1);

    sim1.sessionInit(2);
    sim1.net.setLocalPeer(1);
    sim1.net.connectPeer(0);

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

    sim0.sessionInit(2);
    sim0.net.setLocalPeer(0);
    sim0.net.connectPeer(1);

    sim1.sessionInit(2);
    sim1.net.setLocalPeer(1);
    sim1.net.connectPeer(0);

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
});

import { describe, expect, it } from "bun:test";
import { assert, Bloop, mount } from "../src/mod";
import { startOnlineMatch } from "./helper";

describe("netcode integration", () => {
  it("should route remote peer events to correct player", async () => {
    const [sim0, sim1, game0, game1] = await startOnlineMatch(() => {
      const game = Bloop.create({ bag: { p0Clicks: 0, p1Clicks: 0 } });
      game.system("clicks", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Clicks++;
          if (players[1]?.mouse.left.down) bag.p1Clicks++;
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
    const [sim0, sim1, game0, game1] = await startOnlineMatch(() => {
      const game = Bloop.create({ bag: { p0Clicks: 0, p1Clicks: 0 } });
      game.system("clicks", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Clicks++;
          if (players[1]?.mouse.left.down) bag.p1Clicks++;
        },
      });
      return game;
    });

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

  it("regress: processes two events on the same frame through a rollback session", async () => {
    const [sim0, sim1, game0, game1] = await startOnlineMatch(() => {
      const game = Bloop.create({ bag: { aCount: 0, bCount: 0 } });
      game.system("track-keys", {
        update({ bag, players }) {
          if (players[0]?.keys.a.down) bag.aCount++;
          if (players[0]?.keys.b.down) bag.bCount++;
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
    const packet = sim0.net.getOutboundPacket(1);
    assert(packet);
    sim1.net.receivePacket(packet);
    const packet1 = sim1.net.getOutboundPacket(0);
    assert(packet1);
    sim0.net.receivePacket(packet1);

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
});

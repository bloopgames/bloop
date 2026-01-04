import { describe, expect, it } from "bun:test";
import { readTapeHeader } from "@bloopjs/engine";
import { assert, Bloop, mount, unwrap } from "../src/mod";
import { setupGames, setupSession, startOnlineMatch, stepBoth } from "./helper";

describe("tapes", () => {
  describe("snapshots", () => {
    it("can snapshot the bag", async () => {
      const bloop = Bloop.create({
        bag: {
          cool: 42,
        },
      });

      bloop.system("inc", {
        update({ bag }) {
          bag.cool++;
        },
      });

      const { sim } = await mount(bloop);
      sim.step();

      expect(bloop.bag.cool).toEqual(43);
      const snapshot = sim.snapshot();

      sim.step();
      expect(bloop.bag.cool).toEqual(44);

      sim.restore(snapshot);
      expect(bloop.bag.cool).toEqual(43);
    });

    it("can snapshot the bag on frame 0", async () => {
      const bloop = Bloop.create({
        bag: {
          score: 10,
        },
      });

      const { sim } = await mount(bloop);
      const snapshot = sim.snapshot();
      sim.restore(snapshot);
      expect(bloop.bag.score).toEqual(10);
    });

    it("snapshots time", async () => {
      const bloop = Bloop.create();

      const timeCheck = {
        dt: 0,
        time: 0,
        frame: 0,
      };

      bloop.system("timeCheck", {
        update({ time }) {
          timeCheck.dt = time.dt;
          timeCheck.time = time.time;
          timeCheck.frame = time.frame;
        },
      });

      const { sim } = await mount(bloop);

      sim.step();

      expect(timeCheck.dt).toBeCloseTo(0.016);
      expect(timeCheck.time).toBeCloseTo(0.016);
      expect(timeCheck.frame).toEqual(0);
      expect(bloop.context.time.frame).toEqual(1);

      // const snapshot = bloop.snapshot();
      const snapshot = sim.snapshot();

      sim.step();
      expect(timeCheck.dt).toBeCloseTo(0.016);
      expect(timeCheck.time).toBeCloseTo(0.016 * 2);
      expect(timeCheck.frame).toEqual(1);
      expect(bloop.context.time.frame).toEqual(2);

      sim.restore(snapshot);
      expect(bloop.context.time.frame).toEqual(1);
      sim.step();

      expect(timeCheck.dt).toBeCloseTo(0.016);
      expect(timeCheck.time).toBeCloseTo(0.016 * 2);
      expect(bloop.context.time.frame).toEqual(2);
    });
  });

  describe("local recording and playback", () => {
    it("can step back", async () => {
      const bloop = Bloop.create({
        bag: {
          clicks: 0,
        },
      });

      bloop.system("countClicks", {
        update({ bag, inputs }) {
          if (inputs.mouse.left.down) {
            bag.clicks++;
          }
        },
      });

      const { sim } = await mount(bloop);

      sim.emit.mousedown("Left");
      expect(bloop.context.time.frame).toEqual(0);
      expect(bloop.context.bag.clicks).toEqual(0);

      sim.step();
      expect(bloop.context.time.frame).toEqual(1);
      expect(bloop.bag.clicks).toEqual(1);

      sim.emit.mouseup("Left");
      sim.step();
      expect(bloop.context.time.frame).toEqual(2);
      expect(bloop.bag.clicks).toEqual(1);

      sim.stepBack();
      expect(bloop.context.time.frame).toEqual(1);
      expect(bloop.bag.clicks).toEqual(1);

      sim.stepBack();
      expect(bloop.context.time.frame).toEqual(0);
      expect(bloop.bag.clicks).toEqual(0);
    });

    it("regress - steps back after one frame", async () => {
      const game = Bloop.create({});
      const { sim } = await mount(game);

      sim.step();
      sim.step();
      sim.stepBack();

      expect(game.context.time.frame).toEqual(1);
    });

    it("can start recording mid-game", async () => {
      const game = Bloop.create({
        bag: { score: 0 },
      });

      game.system("scorer", {
        keydown({ event, bag }) {
          if (event.key === "Space") {
            bag.score += 10;
          }
        },
      });

      // Start without recording
      const { sim } = await mount(game, { startRecording: false });
      expect(sim.isRecording).toBe(false);

      // Play for a bit without recording (frames 0->1, 1->2, 2->3)
      sim.step();
      sim.step();
      sim.emit.keydown("Space");
      sim.step();
      expect(game.bag.score).toBe(10);
      expect(game.context.time.frame).toBe(3);

      // Now start recording mid-game at frame 3 (local only)
      sim.record(100, 0);
      expect(sim.isRecording).toBe(true);

      // Score more points while recording (frames 3->4, 4->5)
      sim.emit.keyup("Space");
      sim.step();
      sim.emit.keydown("Space");
      sim.step();
      expect(game.bag.score).toBe(20);
      expect(game.context.time.frame).toBe(5);

      // Save tape and load into replay sim
      const tape = sim.saveTape();
      const { sim: replay } = await mount(game);
      replay.loadTape(tape);

      // Recording should start at score 10, frame 3
      replay.seek(3);
      expect(game.bag.score).toBe(10);

      // Recording should replay space events
      replay.seek(5);
      expect(game.bag.score).toBe(20);
    });
  });

  describe("serialization", () => {
    it("can serialize a tape to bytes and restore from it", async () => {
      const bloop = Bloop.create({
        bag: {
          score: 0,
        },
      });

      bloop.system("scoreSystem", {
        keydown({ event, bag }) {
          if (event.key === "Slash") {
            bag.score += 10;
          }
        },
      });

      const { sim } = await mount(bloop);

      sim.step();
      expect(bloop.bag.score).toEqual(0);
      expect(bloop.context.time.frame).toEqual(1);

      sim.emit.keydown("Slash");
      sim.step();
      expect(bloop.bag.score).toEqual(10);
      expect(bloop.context.time.frame).toEqual(2);

      sim.emit.keyup("Slash");
      sim.step();
      expect(bloop.bag.score).toEqual(10);
      expect(bloop.context.time.frame).toEqual(3);

      const tape = sim.saveTape();

      const { sim: sim1 } = await mount(bloop);
      sim1.loadTape(tape);

      // at the start of frame 2, score should be 10
      sim1.seek(2);
      expect(bloop.bag.score).toEqual(10);
      expect(bloop.context.time.frame).toEqual(2);

      sim1.step();
      expect(bloop.bag.score).toEqual(10);
    });
  });
  describe("tape overflow", () => {
    it("stops recording gracefully when tape is full", async () => {
      const game = Bloop.create({ bag: { count: 0 } });
      let tapeFull = false;
      let savedTape: Uint8Array | null = null;

      const { sim } = await mount(game, {
        tape: { maxEvents: 10 },
      });

      sim.onTapeFull = (tape) => {
        tapeFull = true;
        savedTape = tape;
      };

      for (let i = 0; i < 20; i++) {
        sim.emit.keydown("KeyA");
        sim.step();
        sim.emit.keyup("KeyA");
      }

      // Should not crash - game continues
      expect(tapeFull).toBe(true);
      expect(savedTape).not.toBeNull();
      expect(sim.isRecording).toBe(false);
      expect(game.context.time.frame).toBeGreaterThan(5);
    });

    it("can restart recording from within onTapeFull callback", async () => {
      const game = Bloop.create({ bag: { count: 0 } });
      let restartCount = 0;

      const { sim } = await mount(game, {
        tape: { maxEvents: 10 },
      });

      sim.onTapeFull = () => {
        restartCount++;
        sim.record(10, 0);
      };

      for (let i = 0; i < 50; i++) {
        sim.emit.keydown("KeyA");
        sim.step();
        sim.emit.keyup("KeyA");
      }

      // Should have restarted recording multiple times
      expect(restartCount).toBeGreaterThan(0);
      expect(sim.isRecording).toBe(true);
    });
  });

  describe("networked session recording", () => {
    it("records and replays networked session with delayed packets", async () => {
      const [sim0, sim1, game0] = await startOnlineMatch(() => {
        const game = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
        game.system("score", {
          update({ bag, players }) {
            if (players[0]?.mouse.left.down) bag.p0Score++;
            if (players[1]?.mouse.left.down) bag.p1Score++;
          },
        });
        return game;
      });

      // Frame 0: Player 0 clicks locally, Player 1 clicks on sim1
      sim0.emit.mousedown("Left", 0);
      sim1.emit.mousedown("Left", 1);
      sim0.step();
      sim1.step();
      // p0 click registered locally, p1 click not received yet
      expect(game0.bag).toEqual({ p0Score: 1, p1Score: 0 });

      // Frame 1: No new clicks, p1 packet still delayed
      sim0.step();
      sim1.step();
      expect(game0.bag).toEqual({ p0Score: 1, p1Score: 0 });

      // Frame 2: Still delayed
      sim0.step();
      sim1.step();
      expect(game0.bag).toEqual({ p0Score: 1, p1Score: 0 });

      // Frame 3: Now sim0 receives the delayed packet from frame 0
      const packet = sim1._netInternal.getOutboundPacket(0);
      assert(packet, "Packet from sim1 to sim0 should not be null");
      sim0.emit.packet(packet); // triggers rollback to frame 0
      sim0.step();
      sim1.step();
      // After rollback and resimulation, p1 click is now counted
      expect(game0.bag).toEqual({ p0Score: 1, p1Score: 1 });

      // Frame 4: Continue
      sim0.step();
      sim1.step();
      expect(game0.bag).toEqual({ p0Score: 1, p1Score: 1 });

      // Save tape from sim0's perspective
      const tapeBytes = sim0.saveTape();

      // Create fresh game instance for replay
      const replayGame = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
      replayGame.system("score", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Score++;
          if (players[1]?.mouse.left.down) bag.p1Score++;
        },
      });
      const { sim: replaySim } = await mount(replayGame, {
        startRecording: false,
      });

      // Load tape - session initialized via NetSessionInit event replay
      replaySim.loadTape(tapeBytes);

      // Snapshot is at frame 0 (before setupSession), so replay starts there
      // First step replays frame 0 events (NetSessionInit) - no mousedown yet
      replaySim.step(); // frame 0 -> 1
      expect(replayGame.bag).toEqual({ p0Score: 0, p1Score: 0 });

      // Second step replays frame 1 events (mousedown)
      replaySim.step(); // frame 1 -> 2
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      replaySim.step(); // frame 2 -> 3
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      replaySim.step(); // frame 3 -> 4
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      // Frame 4 -> 5: packet replay should trigger same result as original
      replaySim.step();
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 1 });

      replaySim.step(); // frame 5 -> 6
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 1 });
    });

    it("records session that starts after initial gameplay", async () => {
      const game0 = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
      const game1 = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });

      game0.system("score", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Score++;
          if (players[1]?.mouse.left.down) bag.p1Score++;
        },
      });

      game1.system("score", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Score++;
          if (players[1]?.mouse.left.down) bag.p1Score++;
        },
      });

      const { sim: sim0 } = await mount(game0, { startRecording: false });
      const { sim: sim1 } = await mount(game1, { startRecording: false });

      // Run frames 0 -> 3 before session
      for (let i = 0; i < 3; i++) {
        sim0.step();
        sim1.step();
      }
      setupSession(sim0, sim1);

      // setupSession steps to process network events, we are on frame 4
      expect(game0.context.time.frame).toBe(4);

      // Start recording now (snapshot has session_start_frame=4)
      sim0.record(1000, 2 * 1024 * 1024);

      // Frame 4->5: Player 0 clicks locally, Player 1 clicks on sim1 but we haven't gotten the packet
      sim0.emit.mousedown("Left", 0);
      sim1.emit.mousedown("Left", 1);
      sim0.step();
      sim1.step();
      expect(game0.bag).toEqual({ p0Score: 1, p1Score: 0 });

      // Get delayed packet from sim1 to sim0
      const packet = sim1._netInternal.getOutboundPacket(0);

      // Frame 5->6: No new clicks, p1 packet still delayed
      sim0.step();
      sim1.step();
      expect(game0.bag).toEqual({ p0Score: 1, p1Score: 0 });

      // Frame 6->7: Now sim0 receives the delayed packet
      assert(packet, "Packet from sim1 to sim0 should not be null");
      sim0.emit.packet(packet); // triggers rollback
      sim0.step();
      sim1.step();
      // After rollback and resimulation, p1 click is now counted
      expect(game0.bag).toEqual({ p0Score: 1, p1Score: 1 });

      // Save tape from sim0's perspective
      const tapeBytes = sim0.saveTape();
      expect(tapeBytes.length).toBeGreaterThan(0);

      // Create fresh game instance for replay
      const replayGame = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
      replayGame.system("score", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Score++;
          if (players[1]?.mouse.left.down) bag.p1Score++;
        },
      });
      const { sim: replaySim } = await mount(replayGame, {
        startRecording: false,
      });

      // Load tape - session auto-initialized from snapshot (session_start_frame=3)
      replaySim.loadTape(tapeBytes);
      expect(replaySim.time.frame).toEqual(4);
      expect(replayGame.bag).toEqual({ p0Score: 0, p1Score: 0 });

      replaySim.step();
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      replaySim.step();
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      // 5 -> 6, packet replay should trigger p1 score
      replaySim.step();
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 1 });
    });

    it("allows recording before session init", async () => {
      const [game0, game1] = setupGames(() => {
        const game = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
        game.system("score", {
          update({ bag, players }) {
            if (players[0]?.mouse.left.down) bag.p0Score++;
            if (players[1]?.mouse.left.down) bag.p1Score++;
          },
        });
        return game;
      });

      // Start WITH recording at frame 0 (no session yet)
      const { sim: sim0 } = await mount(game0, { startRecording: true });
      const { sim: sim1 } = await mount(game1, { startRecording: false });

      // Run some frames before session (recording is active but no session)
      sim0.step();
      sim1.step();
      sim0.step();
      sim1.step();
      sim0.step();
      sim1.step();
      expect(game0.context.time.frame).toBe(3);

      // Initialize session at frame 3 (but recording started at frame 0!)
      setupSession(sim0, sim1);

      // Frame 3->4: Player 0 clicks locally, Player 1 clicks on sim1
      sim0.emit.mousedown("Left", 0);
      sim1.emit.mousedown("Left", 1);
      sim0.step();
      sim1.step();
      expect(game0.bag).toEqual({ p0Score: 1, p1Score: 0 });

      // Frame 4->5: p1 packet still delayed
      sim0.step();
      sim1.step();

      // Frame 5->6: Now sim0 receives the delayed packet
      const packet = sim1._netInternal.getOutboundPacket(0);
      assert(packet, "Packet from sim1 to sim0 should not be null");
      sim0.emit.packet(packet);
      sim0.step();
      sim1.step();
      expect(game0.bag).toEqual({ p0Score: 1, p1Score: 1 });

      // Save tape
      const tapeBytes = sim0.saveTape();
      expect(tapeBytes.length).toBeGreaterThan(0);

      // Create fresh game instance for replay
      const replayGame = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
      replayGame.system("score", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Score++;
          if (players[1]?.mouse.left.down) bag.p1Score++;
        },
      });
      const { sim: replaySim } = await mount(replayGame, {
        startRecording: false,
      });

      // Load tape - initial snapshot has in_session=0, so session is initialized
      // via replayed NetSessionInit event
      replaySim.loadTape(tapeBytes);

      // Tape starts at frame 0 - session wasn't active yet at recording start
      replaySim.step(); // frame 0 -> 1 (no events)
      replaySim.step(); // frame 1 -> 2 (no events)
      replaySim.step(); // frame 2 -> 3 (no events)
      replaySim.step(); // frame 3 -> 4 (NetSessionInit replayed, session now active)
      expect(replayGame.bag).toEqual({ p0Score: 0, p1Score: 0 }); // mousedown not yet

      replaySim.step(); // frame 4 -> 5 (mousedown replayed)
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      replaySim.step(); // frame 5 -> 6 (no new input events)
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      replaySim.step(); // frame 6 -> 7 (packet replay triggers p1 score)
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 1 });
    });

    it("regress - captures tape with online session and no input events", async () => {
      const [sim0, sim1] = await startOnlineMatch(() => {
        return Bloop.create();
      });

      const outbound0: Uint8Array[] = [];
      const outbound1: Uint8Array[] = [];

      for (let i = 0; i < 1000; i++) {
        // Capture outgoing packets to simulate network delay
        const packet0 = unwrap(sim0._netInternal.getOutboundPacket(1));
        outbound0.push(packet0);
        const packet1 = unwrap(sim1._netInternal.getOutboundPacket(0));
        outbound1.push(packet1);

        // Step both sims
        sim0.step();
        sim1.step();

        // 2 frame delay on receiving packets
        if (i > 1) {
          const packet0 = unwrap(
            outbound0.shift(),
            `Expected packet on tick ${i}`,
          );
          sim1.emit.packet(packet0);

          const packet1 = unwrap(
            outbound1.shift(),
            `Expected packet on tick ${i}`,
          );
          sim0.emit.packet(packet1);
        }
      }

      // Should have stepped 1000 frames after initial 1 frame step during session setup
      expect(sim0.time.frame).toEqual(1001);

      const tape = sim0.saveTape();

      const header = readTapeHeader(tape);
      expect(header.startFrame).toBe(0);
      expect(header.frameCount).toBe(1002); // 1 initial frame + 1000 steps
    });

    it.skip("regress - handles tape that starts with unconfirmed inputs", () => {
      // Test case to be added -
      // start recording after session init with 3 frames of unconfirmed inputs.
      // upon receiving the packet with the last 3 frames, rollback should happen
    });
  });
});

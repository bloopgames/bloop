import { describe, expect, it } from "bun:test";
import { assert, Bloop, mount } from "../src/mod";
import { setupSession } from "./helper";

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

  describe("playback", () => {
    it("can step back", async () => {
      const bloop = Bloop.create({
        bag: {
          clicks: 0,
        },
      });

      bloop.system("countClicks", {
        update({ bag, inputs, time }) {
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

    it("regression - steps back after one frame", async () => {
      const game = Bloop.create({});
      const { sim } = await mount(game);

      sim.step();
      sim.step();
      sim.stepBack();

      expect(game.context.time.frame).toEqual(1);
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
    it("should stop recording gracefully when tape is full", async () => {
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

  describe("local recording and playback", () => {
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

      // start without recording
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

      // Can save tape successfully
      const tape = sim.saveTape();
      expect(tape.length).toBeGreaterThan(0);

      // Verify tape can be loaded in a fresh sim and replayed correctly
      const { sim: sim2 } = await mount(game);
      sim2.loadTape(tape);

      // At frame 3 (start of recording), score should be 10
      sim2.seek(3);
      expect(game.bag.score).toBe(10);

      // At frame 5 (end of recording), score should be 20
      sim2.seek(5);
      expect(game.bag.score).toBe(20);
    });

    it.skip("restarted recordings have valid tape data (TODO - write this)", async () => {});

    it("replays keydown events from file at correct frame", async () => {
      // Load tape recorded from mario game
      const tapePath = `${import.meta.dir}/tapes/tape-1765838461380.bloop`;
      const tapeBytes = new Uint8Array(await Bun.file(tapePath).arrayBuffer());

      // Track keydown events externally (bag gets overwritten by tape snapshot)
      let spaceDownFrame = -1;
      let keydownCount = 0;

      const game = Bloop.create({ bag: {} });
      game.system("track-keys", {
        keydown({ time, event }) {
          keydownCount++;
          if (event.key === "Space") {
            spaceDownFrame = time.frame;
          }
        },
      });

      const { sim } = await mount(game, { startRecording: false });
      sim.loadTape(tapeBytes);

      // Tape starts at frame 0, space keydown is at frame 94
      expect(sim.time.frame).toBe(0);
      expect(spaceDownFrame).toBe(-1);

      // Step to frame 93 - no space yet
      sim.seek(93);
      expect(sim.time.frame).toBe(93);
      expect(spaceDownFrame).toBe(-1);

      // Step to frame 95 to process events at frame 94
      sim.seek(95);
      expect(sim.time.frame).toBe(95);
      expect(spaceDownFrame).toBe(94);
      expect(keydownCount).toEqual(7);
    });

    it("replays events from file when stepping forward with step()", async () => {
      const tapePath = `${import.meta.dir}/tapes/tape-1765838461380.bloop`;
      const tapeBytes = new Uint8Array(await Bun.file(tapePath).arrayBuffer());

      let spaceDownFrame = -1;

      const game = Bloop.create({ bag: {} });
      game.system("track-keys", {
        keydown({ time, event }) {
          if (event.key === "Space") {
            spaceDownFrame = time.frame;
          }
        },
      });

      const { sim } = await mount(game, { startRecording: false });
      sim.loadTape(tapeBytes);

      expect(sim.time.frame).toBe(0);
      expect(sim.isReplaying).toBe(true);

      // Step forward using step() - should advance and replay events
      for (let i = 0; i < 100; i++) {
        sim.step(16);
      }

      expect(sim.time.frame).toBe(100);
      expect(spaceDownFrame).toBe(94);
    });
  });

  describe("networked session recording", () => {
    it("records and replays networked session with delayed packets", async () => {
      // Game where clicks increment player scores
      const game0 = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
      game0.system("score", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Score++;
          if (players[1]?.mouse.left.down) bag.p1Score++;
        },
      });

      const game1 = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
      game1.system("score", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Score++;
          if (players[1]?.mouse.left.down) bag.p1Score++;
        },
      });

      const { sim: sim0 } = await mount(game0);
      const { sim: sim1 } = await mount(game1);

      // Setup session - sim0 is player 0, sim1 is player 1
      setupSession(sim0, sim1);

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
      const packet = sim1.net.getOutboundPacket(0);
      assert(packet, "Packet from sim1 to sim0 should not be null");
      sim0.net.receivePacket(packet); // triggers rollback to frame 0
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

      // Load tape - session auto-initialized from snapshot
      replaySim.loadTape(tapeBytes);

      replaySim.step(); // frame 0 -> 1
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      replaySim.step(); // frame 1 -> 2
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      replaySim.step(); // frame 2 -> 3
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      replaySim.step(); // frame 3 -> 4 - packet replay should trigger same result
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 1 });

      replaySim.step(); // frame 4 -> 5
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 1 });
    });

    it("records session that starts after initial gameplay", async () => {
      // Game where clicks increment player scores
      const game0 = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
      game0.system("score", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Score++;
          if (players[1]?.mouse.left.down) bag.p1Score++;
        },
      });

      const game1 = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
      game1.system("score", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Score++;
          if (players[1]?.mouse.left.down) bag.p1Score++;
        },
      });

      // Start without recording
      const { sim: sim0 } = await mount(game0, { startRecording: false });
      const { sim: sim1 } = await mount(game1, { startRecording: false });

      // Run some frames before session (no recording)
      sim0.step(); // frame 0 -> 1
      sim1.step();
      sim0.step(); // frame 1 -> 2
      sim1.step();
      sim0.step(); // frame 2 -> 3
      sim1.step();
      expect(game0.context.time.frame).toBe(3);

      // Initialize session at frame 3
      setupSession(sim0, sim1);

      // Start recording now (snapshot has session_start_frame=3)
      sim0.record(1000, 2 * 1024 * 1024);

      // Frame 3->4: Player 0 clicks locally, Player 1 clicks on sim1
      sim0.emit.mousedown("Left", 0);
      sim1.emit.mousedown("Left", 1);
      sim0.step();
      sim1.step();
      // p0 click registered locally, p1 click not received yet
      expect(game0.bag).toEqual({ p0Score: 1, p1Score: 0 });

      // Frame 4->5: No new clicks, p1 packet still delayed
      sim0.step();
      sim1.step();
      expect(game0.bag).toEqual({ p0Score: 1, p1Score: 0 });

      // Frame 5->6: Now sim0 receives the delayed packet
      const packet = sim1.net.getOutboundPacket(0);
      assert(packet, "Packet from sim1 to sim0 should not be null");
      sim0.net.receivePacket(packet); // triggers rollback
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

      // Tape starts at frame 3
      replaySim.step(); // frame 3 -> 4
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      replaySim.step(); // frame 4 -> 5
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      replaySim.step(); // frame 5 -> 6 - packet replay should trigger same result
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 1 });
    });

    it("allows recording before session init", async () => {
      const game0 = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
      game0.system("score", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Score++;
          if (players[1]?.mouse.left.down) bag.p1Score++;
        },
      });

      const game1 = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
      game1.system("score", {
        update({ bag, players }) {
          if (players[0]?.mouse.left.down) bag.p0Score++;
          if (players[1]?.mouse.left.down) bag.p1Score++;
        },
      });

      // Start WITH recording at frame 0 (no session yet)
      const { sim: sim0 } = await mount(game0);
      const { sim: sim1 } = await mount(game1, { startRecording: false });

      // Run some frames before session (recording is active but no session)
      sim0.step(); // frame 0 -> 1
      sim1.step();
      sim0.step(); // frame 1 -> 2
      sim1.step();
      sim0.step(); // frame 2 -> 3
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
      const packet = sim1.net.getOutboundPacket(0);
      assert(packet, "Packet from sim1 to sim0 should not be null");
      sim0.net.receivePacket(packet);
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

      // Load tape - initial snapshot has in_session=0, so no session auto-init
      replaySim.loadTape(tapeBytes);

      // Tape starts at frame 0
      // Step through frames - this will fail because:
      // 1. Session not auto-initialized (snapshot was taken before session)
      // 2. Packets recorded during session won't replay correctly
      replaySim.step(); // frame 0 -> 1
      replaySim.step(); // frame 1 -> 2
      replaySim.step(); // frame 2 -> 3
      replaySim.step(); // frame 3 -> 4 - p0 click should register
      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 0 });

      replaySim.step(); // frame 4 -> 5
      replaySim.step(); // frame 5 -> 6 - packet should replay but session not active

      expect(replayGame.bag).toEqual({ p0Score: 1, p1Score: 1 });
    });

    it.skip("regress - retains match frames when rollback happens", () => {
      // fixed with is_resimulating change
      // run 100 frames
      // start connection
      // start recording
      // peer a is consistently 2 frames behind peer b
      // peer a inputs a jump on match frame 50 and 100
      // dump tape
      // replay tape and ensure that the jump inputs are on the correct match frames
    });
  });
});

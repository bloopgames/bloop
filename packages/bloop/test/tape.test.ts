import { describe, expect, it } from "bun:test";
import { type Key, readTapeHeader } from "@bloopjs/engine";
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
      const packet = sim1.getOutboundPacket(0);
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
      const packet = sim1.getOutboundPacket(0);

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
      const packet = sim1.getOutboundPacket(0);
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
        const packet0 = unwrap(sim0.getOutboundPacket(1));
        outbound0.push(packet0);
        const packet1 = unwrap(sim1.getOutboundPacket(0));
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

    it("regress - handles tape that starts with unconfirmed inputs", async () => {
      // Setup games, step a few frames before establishing session
      const [game0, game1] = setupGames(() => {
        const game = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
        game.system("score", {
          update({ bag, players }) {
            // TODO: fix workaround for not being able to trigger "down" or up on every frame. see failing test in inputs.test.ts
            const player0Keys = unwrap(players[0]).keys;
            const player1Keys = unwrap(players[1]).keys;
            if (
              player0Keys.digit0.down ||
              player0Keys.digit1.down ||
              player0Keys.digit2.down ||
              player0Keys.digit3.down ||
              player0Keys.digit4.down ||
              player0Keys.digit5.down ||
              player0Keys.digit6.down
            )
              bag.p0Score++;

            if (
              player1Keys.digit0.down ||
              player1Keys.digit1.down ||
              player1Keys.digit2.down ||
              player1Keys.digit3.down ||
              player1Keys.digit4.down ||
              player1Keys.digit5.down ||
              player1Keys.digit6.down
            )
              bag.p1Score++;
          },
        });
        return game;
      });
      const { sim: sim0 } = await mount(game0, { startRecording: false });
      const { sim: sim1 } = await mount(game1, { startRecording: false });

      // Run some frames before session (recording is active but no session)
      sim0.step();
      sim1.step();
      sim0.step();
      sim1.step();
      sim0.step();
      sim1.step();

      const sim0Packets: Uint8Array[] = [];
      const sim1Packets: Uint8Array[] = [];

      // Get in an online match, step a few frames with delayed packets
      setupSession(sim0, sim1);

      for (let i = 0; i < 3; i++) {
        sim0.emit.keydown(`Digit${i}` as Key);
        sim1.emit.keydown(`Digit${i}` as Key);
        const packet0 = unwrap(sim0.getOutboundPacket(1));
        sim0Packets.push(packet0);
        const packet1 = unwrap(sim1.getOutboundPacket(0));
        sim1Packets.push(packet1);
        sim0.step();
        sim1.step();
      }

      // Since they haven't received each other's packets yet, scores should be 3-0 on each side
      expect(game0.bag).toEqual({ p0Score: 3, p1Score: 0 });
      expect(game1.bag).toEqual({ p0Score: 0, p1Score: 3 });

      // Start recording at this point - there are unconfirmed local inputs in our queue:
      sim0.record();

      for (let i = 3; i < 6; i++) {
        const packet1 = unwrap(sim1Packets.shift());
        sim0.emit.packet(packet1); // triggers rollbacks

        sim0.emit.keydown(`Digit${i}` as Key);
        sim0.step();
      }

      // Score should be 6-3
      expect(game0.bag).toEqual({ p0Score: 6, p1Score: 3 });
      const tape = sim0.saveTape();

      // Load tape into fresh game instance
      const replayGame = Bloop.create({ bag: { p0Score: 0, p1Score: 0 } });
      replayGame.system("score", {
        update({ bag, players }) {
          // TODO: fix workaround for not being able to trigger "down" or up on every frame. see failing test in inputs.test.ts
          const player0Keys = unwrap(players[0]).keys;
          const player1Keys = unwrap(players[1]).keys;
          if (
            player0Keys.digit0.down ||
            player0Keys.digit1.down ||
            player0Keys.digit2.down ||
            player0Keys.digit3.down ||
            player0Keys.digit4.down ||
            player0Keys.digit5.down ||
            player0Keys.digit6.down
          )
            bag.p0Score++;

          if (
            player1Keys.digit0.down ||
            player1Keys.digit1.down ||
            player1Keys.digit2.down ||
            player1Keys.digit3.down ||
            player1Keys.digit4.down ||
            player1Keys.digit5.down ||
            player1Keys.digit6.down
          )
            bag.p1Score++;
        },
      });
      const { sim: replaySim } = await mount(replayGame, {
        startRecording: false,
      });
      replaySim.loadTape(tape);
      expect(replayGame.bag).toEqual({ p0Score: 3, p1Score: 0 });

      // Replay next 3 frames - with input buffer snapshots, replay correctly
      // processes peer inputs that were unconfirmed when recording started
      for (let i = 0; i < 3; i++) {
        replaySim.step();
      }
      expect(replayGame.bag).toEqual({ p0Score: 6, p1Score: 3 });
    });
  });

  describe("checkpoint snapshots", () => {
    it("subsequent seeks use checkpoints for faster performance", async () => {
      const game = Bloop.create({
        bag: { value: 0 },
      });

      game.system("inc", {
        update({ bag }) {
          bag.value++;
        },
      });

      const { sim } = await mount(game, {
        tape: {
          maxEvents: 50000,
        },
      });

      // Advance to frame 1000
      for (let i = 0; i < 1000; i++) {
        sim.step();
      }

      expect(game.bag.value).toBe(1000);

      // Save the tape and reload with checkpoint options enabled
      const tape = sim.saveTape();
      sim.loadTape(tape, {
        checkpointInterval: 100,
        checkpointMaxSize: 10 * 1024 * 1024,
      });

      // First seek to frame 500 - creates checkpoints at 100, 200, 300, 400
      const firstSeekStart = performance.now();
      sim.seek(500);
      const firstSeekTime = performance.now() - firstSeekStart;

      expect(game.bag.value).toBe(500);

      // Seek to frame 200 - should use checkpoint at 200 (minimal resim)
      const secondSeekStart = performance.now();
      sim.seek(200);
      const secondSeekTime = performance.now() - secondSeekStart;

      expect(game.bag.value).toBe(200);

      // Second seek should be faster since it uses checkpoints
      expect(secondSeekTime).toBeLessThanOrEqual(firstSeekTime + 5);
    });
  });

  describe("pending platform events", () => {
    it("captures platform events emitted before recording starts", async () => {
      // This tests the scenario from onSessionStart() callback:
      // 1. Network events are emitted (peer:join, session:start)
      // 2. Recording starts inside the callback
      // 3. The events should be captured in the tape even though
      //    they were emitted before the observer was enabled

      const game = Bloop.create({
        bag: { isInSession: false as boolean, localPeerId: -1 },
      });

      game.system("session-tracker", {
        update({ bag, net }) {
          bag.isInSession = net.isInSession;
          bag.localPeerId = net.localPeerId;
        },
      });

      const { sim } = await mount(game, { startRecording: false });

      // Emit session events BEFORE starting recording
      // This simulates what happens in scaffold.ts onDataChannelOpen
      sim.emit.network("peer:join", { peerId: 0 });
      sim.emit.network("peer:join", { peerId: 1 });
      sim.emit.network("peer:assign_local_id", { peerId: 0 });
      sim.emit.network("session:start", {});

      // Now start recording
      sim.record(10000);

      // Step to process the events
      sim.step();

      // Verify session is active
      expect(game.bag.isInSession).toBe(true);
      expect(game.bag.localPeerId).toBe(0);

      // Save and load the tape
      const tape = sim.saveTape();

      // Create a new game for replay
      const replayGame = Bloop.create({
        bag: { isInSession: false as boolean, localPeerId: -1 },
      });
      replayGame.system("session-tracker", {
        update({ bag, net }) {
          bag.isInSession = net.isInSession;
          bag.localPeerId = net.localPeerId;
        },
      });

      const { sim: replaySim } = await mount(replayGame, {
        startRecording: false,
      });

      // Load the tape - snapshot is pre-session state
      replaySim.loadTape(tape);
      expect(replayGame.bag.isInSession).toBe(false);

      // Step to replay the events from the tape
      replaySim.step();

      // Session should be active after replaying the events
      expect(replayGame.bag.isInSession).toBe(true);
      expect(replayGame.bag.localPeerId).toBe(0);
    });

    it("captures input events emitted before recording starts", async () => {
      const game = Bloop.create({
        bag: { spacePressed: false as boolean },
      });

      game.system("input-tracker", {
        keydown({ bag, event }) {
          if (event.key === "Space") {
            bag.spacePressed = true;
          }
        },
      });

      const { sim } = await mount(game, { startRecording: false });

      // Emit input event before recording
      sim.emit.keydown("Space");

      // Start recording
      sim.record(10000);

      // Step to process events
      sim.step();

      // During live play, input should be processed
      expect(game.bag.spacePressed).toBe(true);

      // Save and reload
      const tape = sim.saveTape();

      const replayGame = Bloop.create({
        bag: { spacePressed: false as boolean },
      });
      replayGame.system("input-tracker", {
        keydown({ bag, event }) {
          if (event.key === "Space") {
            bag.spacePressed = true;
          }
        },
      });

      const { sim: replaySim } = await mount(replayGame, {
        startRecording: false,
      });

      replaySim.loadTape(tape);
      replaySim.step();

      // Pending input events should now be captured and replayed
      expect(replayGame.bag.spacePressed).toBe(true);
    });
  });

  it("regress: doesn't crash when seeking a network tape due to duplicate platform events", async () => {
    // This tests a bug where seeking in a session tape would cause
    // "Platform event slot full" panic due to duplicate tape replay
    // during rollback resimulation in sessionStep().
    //
    // The bug manifests when:
    // 1. Load a session tape
    // 2. Step forward (playing through the tape)
    // 3. Seek to a frame that requires restoring to an earlier snapshot
    //
    // During the seek, the engine restores to a snapshot then resims forward.
    // The bug was that sessionStep() was replaying tape events during resim,
    // but those events were already in PlatformEventBuffer from the original
    // playthrough in step 2.

    // Create a session with delayed packet delivery that triggers rollbacks
    const [sim0, sim1] = await startOnlineMatch(() => {
      const game = Bloop.create({ bag: { value: 0 } });
      game.system("inc", {
        update({ bag, players }) {
          // Increment on any player click
          if (players[0]?.mouse.left.down) bag.value++;
          if (players[1]?.mouse.left.down) bag.value++;
        },
      });
      return game;
    });

    // Generate some frames with delayed packets that trigger rollbacks
    for (let i = 0; i < 20; i++) {
      // Player 0 and 1 click at different times
      if (i % 3 === 0) sim0.emit.mousedown("Left", 0);
      if (i % 5 === 0) sim1.emit.mousedown("Left", 1);

      // Delay packet delivery to trigger rollbacks
      if (i % 4 === 0 && i > 0) {
        const packet = sim1.getOutboundPacket(0);
        if (packet) sim0.emit.packet(packet);
      }

      sim0.step();
      sim1.step();
    }

    // Save tape from sim0's perspective
    const tape = sim0.saveTape();

    // Create fresh replay game
    const replayGame = Bloop.create({ bag: { value: 0 } });
    replayGame.system("inc", {
      update({ bag, players }) {
        if (players[0]?.mouse.left.down) bag.value++;
        if (players[1]?.mouse.left.down) bag.value++;
      },
    });

    const { sim: replaySim } = await mount(replayGame, {
      startRecording: false,
    });

    // Load the session tape
    replaySim.loadTape(tape);

    // Step forward through most of the tape
    for (let i = 0; i < 15; i++) {
      replaySim.step();
    }
    const frameAfterStepping = replayGame.context.time.frame;

    // Seek to a later frame - this requires restoring to tape start and resimming
    // through frames we already stepped through, which previously caused the crash
    replaySim.seek(frameAfterStepping + 3);

    // If we get here without crashing, the test passes
    expect(replayGame.context.time.frame).toBe(frameAfterStepping + 3);
  });
});

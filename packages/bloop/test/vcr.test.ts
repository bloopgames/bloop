import { describe, expect, it } from "bun:test";
import { Bloop } from "../src/bloop";
import { mount } from "../src/mount";

describe("VcrContext", () => {
  it("exposes isRecording state", async () => {
    const game = Bloop.create({ bag: { recordingState: false as boolean } });

    game.system("check", {
      update({ bag, vcr }) {
        bag.recordingState = vcr.isRecording;
      },
    });

    const { sim } = await mount(game, { startRecording: false });

    sim.step();
    expect(game.bag.recordingState).toBe(false);

    sim.record(100, 0);
    sim.step();
    expect(game.bag.recordingState).toBe(true);

    sim.stopRecording();
    sim.step();
    expect(game.bag.recordingState).toBe(false);
  });

  it("can request recording via wantsRecord()", async () => {
    const game = Bloop.create({
      bag: { frameRecordStarted: -1, isRecording: false as boolean },
    });

    game.system("auto-record", {
      update({ bag, vcr, time }) {
        bag.isRecording = vcr.isRecording;

        // Start recording on frame 2
        if (time.frame === 2 && !vcr.isRecording) {
          vcr.wantsRecord();
        }

        // Track when recording started
        if (vcr.isRecording && bag.frameRecordStarted === -1) {
          bag.frameRecordStarted = time.frame;
        }
      },
    });

    const { sim } = await mount(game, { startRecording: false });

    // Frame 0
    sim.step();
    expect(game.bag.isRecording).toBe(false);

    // Frame 1
    sim.step();
    expect(game.bag.isRecording).toBe(false);

    // Frame 2 - wantsRecord() is called
    sim.step();
    // Recording starts on next tick after wants_record is processed
    expect(game.bag.isRecording).toBe(false);

    // Frame 3 - recording should now be active (processed at start of tick)
    sim.step();
    expect(game.bag.isRecording).toBe(true);
    expect(game.bag.frameRecordStarted).toBe(3);
  });

  it("can stop recording via wantsStop", async () => {
    const game = Bloop.create({
      bag: { frameStopped: -1, isRecording: false as boolean },
    });

    game.system("auto-stop", {
      update({ bag, vcr, time }) {
        bag.isRecording = vcr.isRecording;

        // Stop recording on frame 3
        if (time.frame === 3 && vcr.isRecording) {
          vcr.wantsStop = true;
        }

        // Track when recording stopped
        if (!vcr.isRecording && bag.frameStopped === -1 && time.frame > 0) {
          bag.frameStopped = time.frame;
        }
      },
    });

    const { sim } = await mount(game, { startRecording: true });

    // Frame 0
    sim.step();
    expect(game.bag.isRecording).toBe(true);

    // Frame 1
    sim.step();
    expect(game.bag.isRecording).toBe(true);

    // Frame 2
    sim.step();
    expect(game.bag.isRecording).toBe(true);

    // Frame 3 - wantsStop is set
    sim.step();
    // Still recording this frame, stop processed at start of next tick
    expect(game.bag.isRecording).toBe(true);

    // Frame 4 - recording should now be stopped
    sim.step();
    expect(game.bag.isRecording).toBe(false);
    expect(game.bag.frameStopped).toBe(4);
  });

  it("wantsRecord accepts custom limits", async () => {
    const game = Bloop.create({ bag: { value: 0 } });

    game.system("inc", {
      update({ bag, vcr, time }) {
        bag.value++;

        // Start with custom limits on frame 1
        if (time.frame === 1) {
          vcr.wantsRecord({ maxEvents: 10, maxPacketBytes: 1024 });
        }
      },
    });

    const { sim } = await mount(game, { startRecording: false });

    sim.step();
    sim.step();

    // Recording should start
    sim.step();
    expect(sim.isRecording).toBe(true);

    // Generate events until tape is full
    let tapeFull = false;
    sim.onTapeFull = () => {
      tapeFull = true;
    };

    for (let i = 0; i < 20; i++) {
      sim.emit.keydown("KeyA");
      sim.step();
      sim.emit.keyup("KeyA");
    }

    // Tape should have filled up due to small maxEvents
    expect(tapeFull).toBe(true);
    expect(sim.isRecording).toBe(false);
  });

  it("exposes isReplaying state", async () => {
    const game = Bloop.create({
      bag: { replayingFrames: [] as number[] },
    });

    game.system("check", {
      update({ bag, vcr, time }) {
        if (vcr.isReplaying) {
          bag.replayingFrames.push(time.frame);
        }
      },
    });

    const { sim } = await mount(game);

    // Record some frames
    for (let i = 0; i < 5; i++) {
      sim.step();
    }

    expect(game.bag.replayingFrames).toEqual([]);

    // Save and load tape
    const tape = sim.saveTape();
    const { sim: replaySim } = await mount(game);
    replaySim.loadTape(tape);

    // Clear tracking array
    game.bag.replayingFrames = [];

    // Step through replay
    replaySim.step();
    replaySim.step();
    replaySim.step();

    // isReplaying should be true during tape playback
    expect(game.bag.replayingFrames.length).toBeGreaterThan(0);
  });
});

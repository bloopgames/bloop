# Engine Sidequests

Future improvements and refactoring ideas that aren't blocking current work.

## Extract VCR object from Sim

`sim.zig` is accumulating multiple responsibilities:
- Core simulation stepping (tick, step)
- Input/event management
- Snapshot/restore
- Recording/replaying (tape management)
- Rollback/session management

Consider extracting a `VCR` (video cassette recorder) object that would be responsible for:
- Managing recording state (`is_recording`, `is_replaying`)
- Tape lifecycle (start_recording, stop_recording, load_tape)
- Seek operations
- Driving the Sim during playback

This would leave Sim focused on:
- Core time stepping
- Input/event processing
- Snapshot/restore primitives
- Session/rollback coordination

Benefits:
- Clearer separation of concerns
- Easier to test recording/playback in isolation
- Sim becomes more focused on "what happens in a frame"
- VCR becomes focused on "navigating through time"

## Make RollbackState and NetState not optional

## Address optional chaining on players[0], use a tuple?

## Address peer_id 0

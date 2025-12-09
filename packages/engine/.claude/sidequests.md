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

* In `Sim`, `rollback_state` and `net_state` are optional, leading to a lot of `if let` and optional chaining. We should make them required

## Address typing and optional chaining on players, use a tuple?

in bloop games,

```ts
game.system('fack', {
  update({ players }) {
    // no type hints, player is Player | undefined
    // this is not ergonomic. we should use a strongly typed tuple with MAX_PLAYERS
    players[0]?.mouse.left.down
    players[1]?.mouse.left.down
  }
});
```

## Address peer_id 0

There is some confusion around peer_id 0 representing "local peer" vs the first connected peer. We should clarify this in the netcode design

## Define system outside of game.system?

the AI wanted to do

```ts
const fack = {
  update() { ... }
}

game0.system('fack', fack);
game1.system('fack', fack);
```

we should make this possible with something like

```ts
const fack: System<typeof game0> = { ... }
```
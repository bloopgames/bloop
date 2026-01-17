---
# bloop-4jip
title: Input events should not be queued while sim is paused
status: todo
type: bug
priority: high
created_at: 2026-01-14T22:21:48Z
updated_at: 2026-01-17T15:23:27Z
---

Currently, when the sim is paused, input events (keyboard, mouse) are still emitted via `sim.emit.keydown()` etc. and queued in the WASM engine's event buffer.

## Current behavior
In `App.ts`, the `shouldEmitInputs()` check only looks at `isReplaying`:
```typescript
const shouldEmitInputs = () => !this.sim.isReplaying;
```

This means inputs are queued while paused, which could:
1. Fill up the event buffer unnecessarily
2. Cause unexpected behavior when unpausing (queued inputs suddenly process)

## Expected behavior
Input events should NOT be queued while the sim is paused. The check should be:
```typescript
const shouldEmitInputs = () => !this.sim.isReplaying && !this.sim.isPaused;
```

## Note
This was discovered while working on e2e tests - the tests currently rely on the "bug" behavior (queuing inputs while paused, then unpausing to process them). Once this is fixed, the e2e test helpers may need adjustment.
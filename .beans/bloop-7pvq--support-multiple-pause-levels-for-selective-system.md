---
# bloop-7pvq
title: Support multiple pause levels for selective system execution
status: draft
type: feature
created_at: 2026-01-15T18:51:17Z
updated_at: 2026-01-15T18:51:17Z
---

## Summary

Add support for different pause levels (e.g., system, editor, custom 1, custom 2) so that systems can selectively run based on the current pause state. This enables scenarios like:

- Editor UI systems running while gameplay is paused
- Debug visualization systems running during pause
- Layered pause states (e.g., game paused but editor tools active)

## Use Cases

1. **Editor pause**: Pause gameplay but allow debug UI, inspector, timeline scrubbing
2. **System pause**: Full engine pause, nothing runs
3. **Custom layers**: Game-specific pause layers (e.g., pause menu vs inventory screen)

## Proposed API

```ts
// Systems declare which pause levels they respect
game.system('gameplay', {
  pauseLevels: ['none'], // Only runs when not paused
  update({ bag }) { ... }
});

game.system('debugOverlay', {
  pauseLevels: ['none', 'editor'], // Runs during editor pause
  update({ bag }) { ... }
});

game.system('alwaysRun', {
  pauseLevels: ['all'], // Runs even during system pause
  update({ bag }) { ... }
});

// Setting pause level
sim.setPauseLevel('editor'); // or 'system', 'custom1', etc.
sim.setPauseLevel('none'); // unpause
```

## Dependencies

- Requires: pause state moved into the engine (bloop-yod7)
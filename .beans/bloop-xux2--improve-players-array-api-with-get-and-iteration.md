---
# bloop-xux2
title: Improve players array API with .get() and iteration
status: completed
type: feature
priority: normal
created_at: 2026-01-08T08:36:06Z
updated_at: 2026-01-08T08:39:56Z
---

Make the players API more ergonomic:
- Create Players class with .get(index) that returns PlayerInputContext (not | undefined)
- Make Players iterable, yielding only connected players
- .count property for number of connected players

## Checklist
- [x] Create Players class in packages/bloop/src/players.ts
- [x] Update Context type in packages/bloop/src/context.ts
- [x] Update Bloop constructor in packages/bloop/src/bloop.ts
- [x] Export from mod.ts
- [x] Update tests to use new API
- [x] Run CI to verify
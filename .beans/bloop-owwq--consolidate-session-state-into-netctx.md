---
# bloop-owwq
title: Consolidate Session State into NetCtx
status: completed
type: task
priority: normal
created_at: 2026-01-06T20:46:53Z
updated_at: 2026-01-06T21:06:18Z
---

Remove redundant Session struct and syncNetCtx() function. Make NetCtx the single source of truth for session state. Fix match_frame off-by-one.

## Checklist
- [ ] Add RollbackStats fields to NetCtx (context.zig)
- [ ] Add TypeScript bindings for stats (netContext.ts)
- [ ] Add helper functions in root.zig (getTargetMatchFrame, getConfirmedMatchFrame)
- [ ] Replace Session usages in root.zig
- [ ] Fix match_frame update timing (move to afterTickListener)
- [ ] Delete syncNetCtx function
- [ ] Remove Session field and imports from Engine
- [ ] Delete session.zig file
- [ ] Update/add tests
- [ ] Run tests and fix any issues
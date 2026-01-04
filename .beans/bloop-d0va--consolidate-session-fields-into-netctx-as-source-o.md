---
# bloop-d0va
title: Consolidate Session fields into NetCtx as source of truth
status: todo
type: task
created_at: 2026-01-04T21:19:17Z
updated_at: 2026-01-04T21:19:17Z
---

Currently Session has `start_frame` and `active` fields that are duplicated in NetCtx (`session_start_frame` and `in_session`). The pattern is:
- Session is internal source of truth
- NetCtx copies are synced via `syncNetCtx()` for FFI access

This creates maintenance burden. Consider making NetCtx the single source of truth and having Session methods read from NetCtx instead.

## Fields to consolidate
- `Session.start_frame` → use `NetCtx.session_start_frame`
- `Session.active` → use `NetCtx.in_session`

## Affected files
- `packages/engine/src/netcode/session.zig`
- `packages/engine/src/context.zig`
- `packages/engine/src/root.zig`

## Notes
- Session would need a reference to NetCtx to read these values
- Or Session methods could be moved to Engine which has access to both
- `confirmed_frame` and `stats` should stay in Session (not needed in FFI)
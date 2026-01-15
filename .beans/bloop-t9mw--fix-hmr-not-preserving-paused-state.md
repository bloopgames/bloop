---
# bloop-t9mw
title: Fix HMR not preserving paused state
status: completed
type: bug
priority: normal
created_at: 2026-01-15T18:51:58Z
updated_at: 2026-01-15T18:52:19Z
---

When HMR occurs on a paused game, the new sim starts unpaused. Add pause state transfer to cloneSession.
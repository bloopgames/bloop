---
# bloop-3rqg
title: Fix E2E smoke test inputs dropped while paused
status: completed
type: bug
priority: normal
created_at: 2026-01-19T20:38:12Z
updated_at: 2026-01-19T20:42:32Z
---

Inputs are silently dropped when sim is paused. Tests send inputs while paused, so they never get recorded. Fix by updating advanceFrames() to accept inputs to emit after unpause.
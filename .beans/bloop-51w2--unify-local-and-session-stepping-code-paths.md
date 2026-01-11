---
# bloop-51w2
title: Unify local and session stepping code paths
status: completed
type: task
priority: normal
created_at: 2026-01-11T07:00:56Z
updated_at: 2026-01-11T17:36:13Z
---

Remove the branch in Engine.advance() that uses different code paths for local vs session mode. Make local play a degenerate case of session mode where peer_count=1 and session_start_frame=0.

## Checklist
- [x] Create confirmed_snapshot on Engine.init()
- [x] Rename sessionStep → step
- [x] Remove in_session branch in advance()
- [x] Always update confirmed_snapshot in step()
- [x] Update accessor guards (getMatchFrame, getConfirmedFrame, getPeerFrame, getRollbackDepth)
- [x] Recreate snapshot after session end
- [x] Run engine tests
- [x] Run integration tests
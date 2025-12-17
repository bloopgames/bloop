---
# bloop-golf
title: Unify local and session paths to always use sessionStep
status: todo
type: task
priority: low
created_at: 2025-12-16T23:45:12Z
updated_at: 2025-12-16T23:45:12Z
parent: bloop-u3h8
---

Local play is a session with peer_count=1 where all frames are immediately confirmed. Currently step() has a branch:

```zig
if (self.in_session) {
    self.sessionStep();
} else {
    self.tick(true);
}
```

This could be simplified to always use sessionStep() by:
1. init() sets rollback.peer_count = 1 and takes initial confirmed_snapshot
2. Remove the in_session branch in step()
3. sessionStep handles both cases (local: peer_count=1, all frames confirmed)

Benefits:
- Single code path for all frame stepping
- Local play gets same rollback infrastructure (useful for future features like local rewind)
- Simpler mental model
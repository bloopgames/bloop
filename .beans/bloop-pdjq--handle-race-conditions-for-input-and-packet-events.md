---
# bloop-pdjq
title: Handle race conditions for input and packet events while frame is processing
status: todo
type: bug
priority: low
created_at: 2026-01-07T00:04:34Z
updated_at: 2026-01-08T07:42:38Z
parent: bloop-7ivl
---

Input and packet events may arrive while a frame is being processed, which could lead to race conditions. Need to ensure these events are properly queued and handled after the current frame completes.
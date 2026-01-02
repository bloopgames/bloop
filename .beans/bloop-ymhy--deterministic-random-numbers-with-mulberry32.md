---
# bloop-ymhy
title: Deterministic random numbers with mulberry32
status: todo
type: feature
priority: high
created_at: 2025-12-22T17:01:39Z
updated_at: 2025-12-23T17:18:36Z
blocking:
    - bloop-8hli
---

Implement deterministic PRNG using mulberry32 algorithm. This is required for games like snake that need reproducible random behavior during rewind/replay.
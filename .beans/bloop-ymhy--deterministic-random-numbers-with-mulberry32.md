---
# bloop-ymhy
title: Deterministic random numbers with mulberry32
status: completed
type: feature
priority: normal
created_at: 2025-12-22T17:01:39Z
updated_at: 2026-01-19T17:06:48Z
blocking:
    - bloop-8hli
---

Implement deterministic PRNG using mulberry32 algorithm. This is required for games like snake that need reproducible random behavior during rewind/replay.
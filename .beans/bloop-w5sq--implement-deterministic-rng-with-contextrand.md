---
# bloop-w5sq
title: Implement deterministic RNG with context.rand
status: completed
type: feature
priority: normal
created_at: 2026-01-18T18:56:22Z
updated_at: 2026-01-18T19:03:55Z
---

Add context.rand for deterministic random number generation using mulberry32. PRNG state lives in engine memory and is serialized in snapshots for tape replay.

## API
- context.rand.next() - Returns number in [0, 1)
- context.rand.seed(n) - Set the seed
- context.rand.coinFlip() - boolean
- context.rand.rollDice(6) - 1-6
- context.rand.int(1, 10) - integer in range
- context.rand.shuffle(arr) - Fisher-Yates

## Checklist
- [x] Engine (Zig): Add RandCtx to context.zig
- [x] Engine (Zig): Add rand_ctx field to sim.zig
- [x] Engine (Zig): Add rand to Snapshot in tapes.zig
- [x] Engine (Zig): Expand callback pointer in wasm.zig
- [x] Engine (Zig): Generate offsets in codegen.zig
- [x] Build WASM and verify offsets
- [x] TypeScript: Create RandContext class
- [x] TypeScript: Add RAND_CTX_OFFSET to engine.ts
- [x] TypeScript: Add rand to Context type
- [x] TypeScript: Wire up in bloop.ts
- [x] Write integration tests
- [x] Run all tests
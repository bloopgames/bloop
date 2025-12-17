---
# bloop-85pg
title: Audit silent failures in engine
status: todo
type: task
created_at: 2025-12-17T23:15:42Z
updated_at: 2025-12-17T23:15:42Z
---

Audit the engine codebase for silent failure patterns that should crash during development:

- `catch null` - silently swallowing errors
- `orelse null` - silently handling null optionals
- `catch {}` - empty error handlers
- `catch |_| {}` - discarded errors

During this stage of development, we want to crash early if assumptions are wrong rather than continue in an invalid state. Replace these patterns with explicit error handling or panics.

## Files to audit
- packages/engine/src/sim.zig
- packages/engine/src/wasm.zig
- packages/engine/src/tapes/*.zig
- packages/engine/src/netcode/*.zig
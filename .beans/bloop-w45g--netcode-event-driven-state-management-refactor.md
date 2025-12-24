---
# bloop-w45g
title: 'Netcode: Event-driven state management refactor'
status: completed
type: task
priority: normal
created_at: 2025-12-23T20:06:23Z
updated_at: 2025-12-23T20:28:44Z
---

Move network state management into the Zig engine, making NetContext fully read-only from TypeScript (except wants.roomCode). Network events flow through the event buffer like input events.

## Checklist

- [ ] Phase 1: Add WASM exports for network events (wasm.zig)
- [ ] Phase 2: Update sim.zig process_events() to handle network events
- [ ] Phase 3: Add TypeScript types for new WASM exports (wasmEngine.ts)
- [ ] Phase 4: Update sim.emit.network() to call WASM (sim.ts)
- [ ] Phase 5: Remove TypeScript scaffolding from NetContext
- [ ] Phase 6: Update tests and helpers
- [ ] Run full CI to verify

## Key Files

**Zig:**
- packages/engine/src/wasm.zig
- packages/engine/src/sim.zig

**TypeScript:**
- packages/engine/js/contexts/netContext.ts
- packages/engine/js/wasmEngine.ts
- packages/bloop/src/sim.ts
- packages/bloop/test/helper.ts
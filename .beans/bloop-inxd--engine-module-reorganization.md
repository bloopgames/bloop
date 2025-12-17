---
# bloop-inxd
title: Engine Module Reorganization
status: completed
type: epic
priority: normal
created_at: 2025-12-16T22:55:34Z
updated_at: 2025-12-17T23:22:01Z
parent: bloop-ar9z
---

Clean up engine architecture and separate concerns.

## Background

Currently rollback.zig, net.zig, packets.zig, tapes.zig have overlapping responsibilities.
sim.zig is becoming a god object - should be a state machine that takes inputs and mutates state.

## Target Architecture

- sim.zig - pure state machine, steps frames
- netcode/session.zig - starting/ending sessions, peer management
- netcode/transport.zig - packet sending/receiving
- netcode/rollback.zig - applying inputs to sim instance
- engine.zig - unit testable coordinator with thin wasm wrapper

## Checklist

- [ ] Create netcode/ folder structure
- [ ] Extract netcode/session.zig (peer management)
- [ ] Extract netcode/transport.zig (packet send/receive)
- [ ] Refactor netcode/rollback.zig (input application)
- [ ] VCR extraction from sim.zig
- [ ] Make engine.zig unit testable with thin wasm wrapper
- [ ] Simplify sim.zig to pure state machine
---
# bloop-yffr
title: Event-based packet receipt
status: completed
type: feature
created_at: 2026-01-03T18:15:54Z
updated_at: 2026-01-03T18:15:54Z
---

Refactored packet receipt to use the event-driven pattern like other network events. emit_receive_packet queues a NetPacketReceived event and processes the packet synchronously (while memory is valid), then forwards the event to sim.events for user observation. Net event processing moved from sim.zig to root.zig in flushPendingNetEvents.
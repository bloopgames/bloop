---
# bloop-8p3h
title: Extract coordination logic to root.zig
status: completed
type: task
priority: normal
created_at: 2025-12-17T23:09:35Z
updated_at: 2025-12-17T23:51:42Z
---

Fill out root.zig with business logic from wasm.zig and coordination logic from sim.zig. This will make root.zig the unit-testable engine coordinator, leaving wasm.zig as a thin WASM wrapper and sim.zig as a pure state machine.
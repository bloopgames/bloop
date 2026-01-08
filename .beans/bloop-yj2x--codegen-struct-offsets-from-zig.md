---
# bloop-yj2x
title: Codegen struct offsets from Zig
status: completed
type: feature
priority: normal
created_at: 2026-01-08T04:24:19Z
updated_at: 2026-01-08T04:29:03Z
---

Extend codegen.zig to generate TypeScript constants for struct field offsets and sizes using @offsetOf and @sizeOf. Generate to js/codegen/offsets.ts and update TypeScript consumers (netContext.ts, inputContext.ts, timeContext.ts, inputs.ts) to import from codegen.
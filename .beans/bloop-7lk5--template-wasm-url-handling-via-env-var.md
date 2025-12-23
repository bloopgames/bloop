---
# bloop-7lk5
title: Template WASM URL handling via env var
status: completed
type: task
created_at: 2025-12-23T16:27:26Z
updated_at: 2025-12-23T16:27:26Z
---

Update games to use VITE_ENGINE_WASM_URL env var defined in vite.config.ts (which gets stripped for templates). Templates will have undefined env var, falling back to default CDN URL.

## Checklist
- [x] Update games/hello/vite.config.ts with define for VITE_ENGINE_WASM_URL
- [x] Update games/mario/vite.config.ts with define for VITE_ENGINE_WASM_URL
- [x] Update games/hello/src/main.ts to use env var
- [x] Update games/mario/src/main.ts to use env var
- [x] Test monorepo dev still works
- [x] Verify publish.ts still strips vite.config.ts
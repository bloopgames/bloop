---
# bloop-i3cd
title: Fix E2E test failures - canvas in Shadow DOM
status: completed
type: bug
priority: normal
created_at: 2026-01-19T15:36:46Z
updated_at: 2026-01-19T15:56:08Z
---

Two issues: 1) Intermittent seek error causing CI browser crash, 2) Black screen snapshots. Root cause: canvas inside Shadow DOM interferes with WebGPU+headless Chrome+SwiftShader. Fix: Modify DebugUI to accept external canvas option.
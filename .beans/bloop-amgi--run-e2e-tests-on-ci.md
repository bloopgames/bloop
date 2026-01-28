---
# bloop-amgi
title: Run E2E tests on CI
status: todo
type: task
priority: low
created_at: 2026-01-19T17:12:31Z
updated_at: 2026-01-28T17:23:28Z
---

E2E tests need to pass on CI. Current state:

## Problem
- macOS CI: Metal doesn't work on virtualized GitHub Actions runners
- Linux CI: WebGPU renders black canvas with current Vulkan/SwiftShader flags

## Attempted
- Switched CI from macos-latest to ubuntu-latest
- Added platform-conditional Chrome flags (Vulkan for Linux, Metal for macOS)
- Made snapshot paths OS-agnostic
- PR created: https://github.com/bloopgames/bloop/pull/37

## Current state
Linux CI fails - WebGPU canvas renders completely black. The debug UI (FPS counter, toolbar) shows but game content doesn't render.

## Next steps to try
- [ ] Different Chrome flags for Linux (try `--use-gl=swiftshader` or `--use-angle=swiftshader`)
- [ ] Try `--disable-gpu-sandbox` flag
- [ ] Consider WebGL fallback for CI instead of WebGPU
- [ ] Or skip visual tests in CI, only run locally on macOS
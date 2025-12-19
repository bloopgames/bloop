---
# bloop-32f8
title: Design and implement netcode API
status: todo
type: feature
priority: normal
created_at: 2025-12-18T23:00:37Z
updated_at: 2025-12-19T19:39:07Z
parent: bloop-52uc
---

Update the netcode API to be callable from game code (not just internal engine use).

## Requirements

- Netcode API should be accessible from TypeScript game code
- Support async loading to populate game bag (e.g., loading assets or initial state before netcode session starts)
- Allow games to control when netcode sessions start/stop

## Use Cases

- Game wants to load sprites/assets asynchronously before starting netcode
- Game wants to populate bag with loaded data before first snapshot
- Game wants to manually trigger netcode connection after some UI flow
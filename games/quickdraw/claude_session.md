# Rollback Netcode Session Summary (2025-12-04)

**Branch:** `nu11/rollback`

## What we built

- Clock syncing via `sessionStartFrame` captured on data channel open
- `matchFrame` field added to packets for tracking remote progress
- Rollback system: restore snapshot → resim confirmed frames → predict to current
- `isResimulating` guard to prevent recursive callbacks
- `skipRollback` URL param for A/B comparison

## Current bug

Events are being lost during rollback because:
1. `app.sim.restore()` replaces the event buffer
2. `app.sim.step()` during resim flushes events

## Proposed fix

Stash the engine's event buffer before rollback, restore it after. Events are at `app.sim.wasm.get_events_ptr()`.

## Key files

- `games/quickdraw/src/main.ts` - main netcode logic (rollback happens around line 440)
- `games/quickdraw/src/netcode/inputs.ts` - packet encoding with matchFrame field

## Remaining tasks

- Fix event buffer being overwritten during rollback
- Move network stats outside the game bag (they're being rolled back)
- Debug why clicks don't register on phone
- Test rollback with simulated latency (`?lag=100`)

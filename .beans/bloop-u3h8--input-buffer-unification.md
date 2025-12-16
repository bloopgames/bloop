---
# bloop-u3h8
title: Input Buffer Unification
status: in-progress
type: epic
priority: normal
created_at: 2025-12-16T22:55:25Z
updated_at: 2025-12-16T23:26:13Z
parent: bloop-nti4
---

Unify all input handling to use a single canonical input buffer with match_frame tagging.

## Background

Currently there are multiple separate queues that must be kept in sync:
- Unacked inputs (to send to peer)
- Rollback inputs (confirmed inputs from us and peers)
- Tape inputs (recorded local inputs with different frame mechanism)
- Event buffer (read during frame processing)

Also `append_event` (for local) and `rollback.emit_inputs` (for online) have different and untested behavior.

## Goals

- All inputs (local or remote) tagged with match_frame
- Single canonical source of truth for inputs
- Packets, tape recording, and rollback processing are views onto that source
- Local play is a special case where match_frame == frames since start

## Checklist

- [ ] Audit current input flow (app → wasm → queues)
- [ ] Design canonical input buffer with match_frame tagging
- [ ] Unify append_event and rollback.emit_inputs
- [ ] Remove/consolidate duplicate queues
- [ ] Update tape recording to be a view on canonical buffer
- [ ] Add tests for unified flow
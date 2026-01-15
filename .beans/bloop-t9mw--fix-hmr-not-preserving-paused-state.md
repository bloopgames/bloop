---
# bloop-t9mw
title: Fix HMR not preserving paused state
status: completed
type: bug
priority: normal
created_at: 2026-01-15T18:51:58Z
updated_at: 2026-01-15T19:24:30Z
---

Fixed two HMR bugs in cloneSession:

1. Pause state not preserved - added `this.#isPaused = source.isPaused`
2. Tape not transferred in replay mode - changed `source.isRecording` to `source.hasHistory`

The second bug occurred when loading a tape file for replay (not recording), then triggering HMR. The tape wasn't transferred because cloneSession only checked isRecording, not isReplaying.
---
# bloop-2zdp
title: Fix mobile debug UI issues
status: completed
type: bug
priority: normal
created_at: 2026-01-10T01:41:12Z
updated_at: 2026-01-11T04:17:35Z
parent: bloop-7ivl
---

Two issues found after initial mobile implementation:

1. Bottom bar cut off by iPhone address bar - need to use dvh units instead of vh
2. Netcode panels broken:
   - Game aspect ratio changes (should stay fullscreen)
   - Scrolling doesn't work - browser bounces
   - Canvas may be intercepting touch events

## Checklist
- [ ] Fix bottom bar visibility with dvh units
- [ ] Fix netcode panel scrolling on mobile
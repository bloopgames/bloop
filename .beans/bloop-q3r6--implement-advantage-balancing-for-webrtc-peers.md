---
# bloop-q3r6
title: Implement advantage balancing for WebRTC peers
status: completed
type: feature
priority: normal
created_at: 2026-01-16T20:12:56Z
updated_at: 2026-01-16T20:17:00Z
---

Add stall mechanism to balance frame advantage between peers. When one peer runs ahead, stall their simulation to let the other catch up. Uses distributed stalling based on INVERSUS algorithm.
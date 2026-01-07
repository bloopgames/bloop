---
# bloop-9jk8
title: Tape recording doesn't replicate input buffer
status: completed
type: bug
priority: high
created_at: 2026-01-05T05:51:59Z
updated_at: 2026-01-06T21:34:10Z
parent: bloop-7ivl
---

There's a skipped test in netcode.test.ts for this scenario:

1. Start a network session
2. Local click on frame 1
3. Step forward for three steps
4. Start recording
5. Receive a packet from the peer with a click on match frame 1

The packet won't be replayed because the session recording doesn't have a copy of the input buffer. It won't have our local input and won't know to run a confirm frame when the packet is received.
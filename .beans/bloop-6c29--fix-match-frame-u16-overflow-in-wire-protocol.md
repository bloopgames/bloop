---
# bloop-6c29
title: Fix match_frame u16 overflow in wire protocol
status: completed
type: bug
priority: normal
created_at: 2026-01-05T16:17:38Z
updated_at: 2026-01-05T16:51:54Z
---

The wire protocol uses u16 for frame numbers which will panic after ~18 min of gameplay (65536 frames).

## Solution
Add base_frame_high: u16 to PacketHeader (upper 16 bits of u32 match_frame). Bump WIRE_VERSION to 2.

## Checklist
- [x] Update PacketHeader in transport.zig (add base_frame_high, bump version, update HEADER_SIZE to 10)
- [x] Add toFullFrame helper function
- [x] Update packet building in root.zig (use @truncate, set base_frame_high)
- [x] Update packet receiving in root.zig (reconstruct u32, handle epoch boundary)
- [x] Update tests
- [x] Expand TapeHeader.frame_count to u32
- [x] Update PeerUnackedWindow to use u32 (fixes epoch boundary in unacked tracking)
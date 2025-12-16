# Bloop Roadmap: December 2025 → January 2026

## The Goal

Public launch of Bloop during birthday week (Jan 5-10, 2026) with:
- A polished [GIF](GIF_STORYBOARD.md) on the README
- A 45-60 second video
- Posts to web gamedev discord, Zig discord, Bun discord, and beyond

---

## Phase 1: Soft Launch (Dec 16-20)

**Goal:** GIF ready, shared with trusted circle for feedback

### Build
- [x] Frame counter UI
- [x] Wire HMR → CA pulse trigger
- [ ] Record network packets to tape / replay online matches
- [ ] Fix cmd+s not working on deployed site
- [ ] Fix stuck inputs bug
- [ ] Add player-player collisions to mario game
- [ ] Sprite animations for mario game
- [ ] Add inputs UI to mario game (match https://bymuno.com/post/rollback)
- [ ] Update mario gamefeel and physics to match 1-1
- [ ] Update mario environment art
- [ ] Chromatic aberration post-process shader
- [ ] Debug hitbox toggle

### Capture
- [ ] Record GIF sequence (multiple takes)
- [ ] Encode with gifski
- [ ] Update README with GIF

### Share
- [ ] Post to Void discord for feedback
- [ ] Playtests with Paul and Ben

---

## Phase 2: Polish (Dec 21 - Jan 4)

**Goal:** Address feedback, build video, harden demo, build initial GitHub traction

### Quality
- [ ] Fix any issues surfaced in playtesting
- [ ] Fix tape crash-when-full bug
- [ ] Tapes robustness (last-mile stuff)
- [ ] Any embarrassing edge cases

### Video Production
- [ ] Record all footage (see storyboard for shot list)
- [ ] Edit 45-60 second video
- [ ] Add text overlays / captions
- [ ] Upload to YouTube (listed)
- [ ] Optional: voiceover, music

### README / Repo Polish
- [ ] Finalize GIF based on feedback
- [ ] Ensure easy local setup for curious devs
- [ ] Any quick wins on documentation

### Star Campaign
- [ ] Reach out individually to everyone you know with a GitHub account
- [ ] Ask them to star the repo
- [ ] **Goal: 20+ stars by Jan 5**

### Streaming Prep
- [ ] Install OBS, configure for Mac (720p30, Apple VT H264 Hardware Encoder, 2500-4000 kbps)
- [ ] Install Chatterino, configure OS notifications for Twitch chat
- [ ] Test audio levels (MacBook mic or AirPods to start)
- [ ] Do 3-5 silent practice streams (go live without telling anyone)
- [ ] Practice talking out loud while working

**Target schedule for January:** 9am-12pm PT, Monday-Friday
(noon-3pm ET, 5pm-8pm UK/EU)

### Background Thread (evenings)
- [ ] Continue Nintendo Switch spike
- [ ] No pressure, just exploration

---

## Phase 3: Public Launch (Jan 5-10, 2026)

**Goal:** Get Bloop in front of real game developers

### Launch Assets Ready
- [ ] GIF on README
- [ ] Video on YouTube (listed)
- [ ] 20+ GitHub stars

### Distribution Plan

**Discords (primary):**
1. **Web GameDev Discord** - Core audience, browser games
2. **Zig Discord** - Technical crowd, will appreciate the architecture
3. **Bun Discord** - JS/TS runtime community, relevant ecosystem

**Social:**
- Twitter (not super active, but post anyway)
- LinkedIn

**Later / opportunistic:**
- r/gamedev - Broad reach, upvote-dependent
- Hacker News - High risk/high reward, save for the right moment

### What Success Looks Like
- People try it and give feedback
- Questions reveal what's unclear or missing
- Maybe: a few stars, a few follows, one or two "this is cool"
- Learn what resonates for future messaging

---

## Phase 4: Global Game Jam (Late Jan)

**Goal:** Polish based on feedback, support jam participants

- [ ] Address feedback from public launch
- [ ] Leave room for community requests
- [ ] TBD based on what we learn

---

## Phase 5: GDC (March)

**Goal:** TBD

- [ ] Unclear - depends on traction and feedback

---

## What's NOT in Scope (Yet)

These are important but come after public feedback:

- ECS (table stakes, but not blocking launch)
- Editor tooling (config editor, scene builder)
- Logo (nice to have, not blocking)
- Additional platform targets beyond browser
- Godot/Toodle integrations

---

## Key Dates

| Date | Milestone |
|------|-----------|
| Dec 16-20 | GIF done, Void discord share, playtests |
| Dec 21-31 | Polish, video production, star outreach |
| Jan 1-4 | Video done, 20+ stars |
| **Jan 5-10** | **Public launch (birthday week)** |
| Late Jan | Global Game Jam |
| March | GDC |

---

*Last updated: Dec 13, 2025*

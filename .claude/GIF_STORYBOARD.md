# Bloop Marketing Storyboards

## GIF: "The Hook" (6-8 seconds)

**Concept:** Rewind → code change (signaled by chromatic aberration pulse) →
different outcome. Proves this is live simulation, not video playback.

**Format:** 640px wide, smooth loop, silent autoplay

**Key visual elements:**
- Frame counter in corner (real UI, proves it's a simulation)
- Debug hitboxes (toggle on during the "change" moment)
- Chromatic aberration pulse (signals HMR/code change)

### The Chromatic Aberration Pulse

This is real product UI, not just for the GIF. It signals "your simulation just changed."

**Implementation:**
- Offset R channel by -3 to -5px (toward upper-left)
- Offset B channel by +3 to +5px (toward lower-right)
- G channel stays in place
- Duration: ~100-150ms (4-5 frames at 30fps)
- Easing: snap on, fade out over 2-3 frames

**Reference:** See the impact effect in Harry Alisavakis's "Liches and Crawls":
https://halisavakis.com/my-take-on-shaders-chromatic-aberration-introduction-to-image-effects-part-iv/

**Why this works for the GIF:**
- Unmissable even at small size
- Clearly "system event" not "gameplay event"
- Quick enough to not disrupt the flow
- Pairs perfectly with hitbox change to create cause→effect

### Storyboard

```
PHASE 1: SETUP (0:00-0:02)

* Two players running and jumping toward block
* Frame counter ticking up: 847, 848, 849...
* Hitboxes visible
```

```
PHASE 2: THE MISS (0:02-0:03)

* Players dont bump into each other when they should - hitboxes are too small

This is the "before" state that we'll fix
```

```
PHASE 3: REWIND (0:03-0:04)

* Game pauses with vignette effect
* Frame counter going DOWN: 851, 850, 849, 848...
* Gameplay rewinding
* Small ◀◀ indicator appears in corner
```

```
PHASE 4: THE CHANGE (0:04-0:04.5) ← THE MONEY SHOT

SIMULTANEOUSLY:
1. Chromatic aberration pulse (100-150ms)
2. Toast notification saying "collisionSystem.ts - updated 3 lines"
3. Hitboxes change size

The CA pulse says "something changed"
The toast and hitboxes show WHAT changed
```

```
PHASE 5: PLAY FORWARD - THE HIT (0:04.5-0:06)

* Frame counter going UP again: 848, 849, 850, 851
* At frame 851 - COLLISION NOW HAPPENS
* Hitboxes overlap, visual feedback (spark/flash)
* Player gets the coin
```

```
PHASE 6: RESOLUTION + LOOP (0:06-0:08)

* Brief celebration moment
* Loop back to Phase 1 (frame counter resets to ~847)
```

### Visual Polish Notes

**Frame counter:**
- Top-left corner, monospace font
- Small but legible at 640px width (~14-16px)
- This is REAL - it proves you're watching a simulation, not a video

**Hitboxes:**
- Simple rectangles, semi-transparent
- Different color per player (e.g., blue vs red outlines)
- Only visible during phases 4-5

**Chromatic aberration pulse:**
- Peaks at ~4-5px offset
- Snaps on (1 frame), fades out (2-3 frames)
- Applied to entire screen

**Loop point:**
- After celebration, quick fade or cut to setup
- OR: hitboxes fade, we rewind again naturally to start

### What This GIF Communicates

Without any text or explanation, a viewer sees:

1. A game playing
2. Two players miss each other
3. Time reverses (frame counter confirms)
4. Screen "glitches" briefly, boxes appear
5. Time plays forward
6. Same moment, but now they collide

The implication is clear: **something changed, and the simulation responded.**
The README text can then explain HOW (code change, hot reload).

---

## Checklist

To capture this GIF, you need:

### Dev

- [ ] Critical bugs fixed on startRecording: true
- [ ] Polish on Mario rollback demo
- [ ] Frame counter visible in game
- [ ] Debug hitbox rendering
- [ ] Chromatic aberration post-process effect for HMR pulse
- [ ] Vignette post-process effect for pause
- [ ] Some sort of playbar ui eg ◀◀ for rewind
- [ ] HMR triggering the CA pulse
- [ ] HMR triggering toast notification
- [ ] A scenario where hitbox size change = collision vs no collision

### Production

- [ ] Screen recording at consistent framerate (30fps ideal for GIF)
- [ ] gifski or similar for high-quality GIF output

---

*Last updated: Dec 13, 2024*

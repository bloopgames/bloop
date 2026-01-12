export const styles = /*css*/ `
/* Reset for shadow DOM */
* {
  box-sizing: border-box;
}

/* Mobile-first CSS variables */
:host {
  --bar-size: 10vw;
  --bar-size-h: 10vh;
  --bar-size-h: 10dvh;
}

/* Desktop overrides */
@media (min-width: 769px) {
  :host {
    --bar-size: 2vw;
    --bar-size-h: 2vh;
  }
}

/* Layout */
.fullscreen {
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.fullscreen .canvas-container {
  width: 100%;
  height: 100%;
}

.fullscreen canvas {
  width: 100%;
  height: 100%;
  display: block;
}

/* Mobile-first: vertical scroll layout */
.layout {
  /* Use fixed position on mobile to escape parent overflow:hidden */
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  padding: 0;
  gap: 0;
  background: #1a1a1a;
}

.layout .game {
  /* Use dvh with vh fallback for mobile Safari address bar */
  height: 100vh;
  height: 100dvh;
  width: 100%;
  flex-shrink: 0;
  /* Mobile: no border radius, fullscreen game */
  border-radius: 0;
}

/* Mobile: stretch canvas to fill game area */
.layout .game .canvas-container {
  width: 100%;
  height: 100%;
}

.layout .game .canvas-container canvas {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  display: block;
}

.layout .stats,
.layout .logs {
  width: 100%;
  min-height: 50vh;
  min-height: 50dvh;
  padding: 1rem;
  flex-shrink: 0;
}

/* Desktop: 2x2 grid layout */
@media (min-width: 769px) {
  .layout {
    position: static;
    display: grid;
    grid-template-areas:
      "game stats"
      "logs logs";
    grid-template-columns: calc(50% - 0.5rem) calc(50% - 0.5rem);
    grid-template-rows: calc(50% - 0.5rem) calc(50% - 0.5rem);
    gap: 1rem;
    padding: 1rem;
    height: 100%;
    overflow: hidden;
    -webkit-overflow-scrolling: auto;
    overscroll-behavior-y: auto;
  }

  .layout .game {
    height: auto;
    flex-shrink: initial;
    border-radius: 8px;
  }

  /* Desktop: restore centered canvas with constraints */
  .layout .game .canvas-container canvas {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
  }

  .layout .stats,
  .layout .logs {
    min-height: auto;
    padding: 1rem;
    flex-shrink: initial;
  }
}

/* Letterboxed layout - using equal vw/vh percentages keeps game at viewport aspect ratio */
.layout-letterboxed {
  display: grid;
  grid-template-areas:
    "top-bar top-bar top-bar"
    "left-bar game right-bar"
    "bottom-bar bottom-bar bottom-bar";
  grid-template-columns: var(--bar-size) 1fr var(--bar-size);
  grid-template-rows: var(--bar-size-h) 1fr var(--bar-size-h);
  width: 100vw;
  /* Use dvh with vh fallback for mobile Safari address bar */
  height: 100vh;
  height: 100dvh;
  background: #1a1a1a;
  overflow: hidden;
  overscroll-behavior: none;
}

.top-bar {
  grid-area: top-bar;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #111;
  color: #aaa;
  font-family: monospace;
  font-size: 12px;
  padding: 0;
}

.top-bar-side-label {
  width: var(--bar-size);
  text-align: center;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #666;
}

/* Mobile: larger top bar text */
@media (max-width: 768px) {
  .top-bar-side-label {
    font-size: 12px;
  }

  .top-bar {
    font-size: 14px;
  }
}

.top-bar-center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  flex: 1;
}

.top-bar-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.top-bar-label {
  opacity: 0.6;
}

.top-bar-value {
  color: #fff;
  font-weight: 500;
}

.left-bar {
  grid-area: left-bar;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  background: #111;
  padding: 4px 0;
}

.right-bar {
  grid-area: right-bar;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  background: #111;
  padding: 4px 0;
}

.vertical-bar {
  width: 12px;
  flex: 1;
  background: #333;
  border-radius: 2px;
  position: relative;
  overflow: hidden;
}

.vertical-bar-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: #4a9eff;
  border-radius: 2px;
  transition: height 0.1s ease-out;
}


.bottom-bar {
  grid-area: bottom-bar;
  display: flex;
  align-items: center;
  background: #111;
  /* Mobile-first: more padding */
  padding: 0 16px;
  gap: 12px;
}

/* Desktop: tighter padding */
@media (min-width: 769px) {
  .bottom-bar {
    padding: 0 8px;
    gap: 8px;
  }
}

.playbar-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

/* Recording indicator - mobile: just the dot */
.recording-indicator {
  display: flex;
  align-items: center;
  margin-right: 4px;
}

.recording-indicator .recording-label {
  display: none;
}

.recording-dot {
  width: 10px;
  height: 10px;
  background: #ff4444;
  border-radius: 50%;
  animation: recording-pulse 1s ease-in-out infinite;
}

@keyframes recording-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* Replay indicator - mobile: hidden */
.replay-indicator {
  display: none;
}

/* Desktop: full indicators with text */
@media (min-width: 769px) {
  .recording-indicator {
    gap: 4px;
    padding: 2px 6px;
    background: rgba(255, 0, 0, 0.2);
    border: 1px solid #ff4444;
    border-radius: 3px;
  }

  .recording-indicator .recording-label {
    display: inline;
    color: #ff4444;
    font-size: 10px;
    font-weight: bold;
    font-family: monospace;
  }

  .recording-dot {
    width: 8px;
    height: 8px;
  }

  .replay-indicator {
    display: flex;
    align-items: center;
    padding: 2px 6px;
    background: rgba(100, 100, 255, 0.2);
    border: 1px solid #6666ff;
    border-radius: 3px;
    color: #6666ff;
    font-size: 10px;
    font-weight: bold;
    font-family: monospace;
    margin-right: 4px;
  }
}

/* Mobile-first: hide step/jump buttons */
.playbar-btn.jump-back,
.playbar-btn.step-back,
.playbar-btn.step-forward,
.playbar-btn.jump-forward {
  display: none;
}

/* Desktop: show all controls */
@media (min-width: 769px) {
  .playbar-btn.jump-back,
  .playbar-btn.step-back,
  .playbar-btn.step-forward,
  .playbar-btn.jump-forward {
    display: flex;
  }
}

.playbar-btn {
  /* Mobile-first: larger buttons */
  width: 4vh;
  height: 4vh;
  min-width: 32px;
  min-height: 32px;
  border: none;
  outline: none;
  background: transparent;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  position: relative;
}

/* Desktop: sized to match indicators */
@media (min-width: 769px) {
  .playbar-btn {
    width: 24px;
    height: 24px;
    min-width: 24px;
    min-height: 24px;
  }

  /* Save/Load buttons need room for icon + text */
  .playbar-btn.save-tape-btn,
  .playbar-btn.load-tape-btn {
    width: auto;
    padding: 0 6px;
    gap: 4px;
  }
}

/* Mobile-first: hide button text labels, show only icons */
.btn-label {
  display: none;
}

/* Desktop: show button text labels */
@media (min-width: 769px) {
  .btn-label {
    display: inline;
  }
}

.playbar-btn:hover {
  background: #333;
  color: #fff;
}

.playbar-btn:hover .tooltip {
  opacity: 1;
  visibility: visible;
}

.tooltip {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  background: #222;
  color: #ccc;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 10px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s;
  pointer-events: none;
  z-index: 10;
}

.tooltip-left {
  left: 0;
  transform: none;
}

.tooltip kbd {
  background: #444;
  padding: 1px 4px;
  border-radius: 2px;
  margin-left: 4px;
  font-family: monospace;
}

.seek-bar {
  flex: 1;
  /* Mobile-first: larger seek bar */
  height: 32px;
  background: #222;
  border-radius: 4px;
  position: relative;
  cursor: pointer;
  overflow: hidden;
}

/* Desktop: smaller seek bar */
@media (min-width: 769px) {
  .seek-bar {
    height: 16px;
  }
}

.seek-bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: linear-gradient(to right, #4a2070, #7b3fa0);
  border-radius: 4px;
  transition: width 0.1s ease-out;
}

.seek-bar-position {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #fff;
}

.letterboxed-game {
  grid-area: game;
  overflow: hidden;
}

.letterboxed-game .canvas-container {
  width: 100%;
  height: 100%;
}

.letterboxed-game canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.letterboxed-game {
  position: relative;
}

.letterboxed-game.hmr-flash::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  animation: hmr-pulse 0.3s ease-out forwards;
}

@keyframes hmr-pulse {
  0% { box-shadow: inset 0 0 0 36px #7b3fa0; }
  100% { box-shadow: inset 0 0 0 0 #7b3fa0; }
}

.game {
  grid-area: game;
  border-radius: 8px;
  overflow: hidden;
}

.stats {
  grid-area: stats;
  background-color: #f0f0f0;
  padding: 1rem;
  border-radius: 8px;
  overflow: hidden;
}

.logs {
  grid-area: logs;
  background-color: #f0f0f0;
  padding: 1rem;
  border-radius: 8px;
  overflow: hidden;
}

/* Canvas container */
.canvas-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.canvas-container canvas {
  max-width: 100%;
  max-height: 100%;
}

/* Debug toggle button */
.debug-toggle {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background-color: rgba(0, 0, 0, 0.5);
  color: white;
  font-size: 18px;
  cursor: pointer;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.debug-toggle:hover {
  background-color: rgba(0, 0, 0, 0.7);
}

/* Stats panel */
.stats-panel {
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 12px;
  border-radius: 8px;
  font-family: monospace;
  font-size: 14px;
  max-width: 100%;
  overflow: hidden;
}

.stats-panel h3 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stats-panel table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.stats-panel tr {
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.stats-panel tr:last-child {
  border-bottom: none;
}

.stats-panel td {
  padding: 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stats-panel td:first-child {
  opacity: 0.7;
  width: 60%;
}

.stats-panel td:last-child {
  text-align: right;
  font-weight: 600;
  width: 40%;
}

.stats-panel p {
  margin: 0;
  opacity: 0.7;
}

/* Logs panel */
.logs-list {
  width: 100%;
  height: 100%;
  overflow: auto;
  margin: 0;
  padding: 0;
}

.logs-list li {
  margin: 0 0 24px 0;
  list-style: none;
}

.logs-list h3 {
  font-size: 16px;
  font-weight: 500;
  margin: 0;
}

.logs-list .ws {
  color: darkolivegreen;
}

.logs-list .webrtc {
  color: darkmagenta;
}

.logs-list .rollback {
  color: darkblue;
}

.logs-list .local {
  color: #333;
}

.logs-list .content {
  font-size: 16px;
}

.logs-list p {
  margin: 4px 0;
}

.logs-list pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  background-color: oldlace;
  padding: 8px;
  border-radius: 4px;
  border: 1px inset lavender;
}

/* Load Tape Dialog */
.load-tape-dialog {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 0;
  color: #ccc;
  font-family: monospace;
  max-width: 320px;
  width: 90vw;
}

.load-tape-dialog::backdrop {
  background: rgba(0, 0, 0, 0.7);
}

.load-tape-dialog-content {
  padding: 16px;
}

.load-tape-dialog h3 {
  margin: 0 0 16px 0;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.drop-zone {
  border: 2px dashed #444;
  border-radius: 8px;
  padding: 32px 16px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.drop-zone:hover {
  border-color: #666;
  background: #222;
}

.drop-zone.drag-over {
  border-color: #7b3fa0;
  background: rgba(123, 63, 160, 0.1);
}

.drop-zone-text {
  color: #888;
  font-size: 12px;
  line-height: 1.5;
}

.hidden-file-input {
  display: none;
}

.replay-last-btn {
  width: 100%;
  margin-top: 12px;
  padding: 8px 12px;
  background: #333;
  border: none;
  border-radius: 4px;
  color: #ccc;
  font-family: monospace;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.replay-last-btn:hover {
  background: #444;
  color: #fff;
}

.load-tape-btn {
  margin-left: 4px;
}
`;

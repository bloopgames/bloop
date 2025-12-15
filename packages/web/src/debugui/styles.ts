export const styles = /*css*/ `
/* Reset for shadow DOM */
* {
  box-sizing: border-box;
}

/* Layout */
.fullscreen {
  width: 100vw;
  height: 100vh;
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

.layout {
  display: grid;
  grid-template-areas:
    "game stats"
    "logs logs";
  grid-template-columns: calc(50% - 0.5rem) calc(50% - 0.5rem);
  grid-template-rows: calc(50% - 0.5rem) calc(50% - 0.5rem);
  gap: 1rem;
  width: 100%;
  height: 100%;
  padding: 1rem;
}

/* Letterboxed layout - using equal vw/vh percentages keeps game at viewport aspect ratio */
.layout-letterboxed {
  display: grid;
  grid-template-areas:
    "top-bar top-bar top-bar"
    "left-bar game right-bar"
    "bottom-bar bottom-bar bottom-bar";
  grid-template-columns: 2vw 1fr 2vw;
  grid-template-rows: 2vh 1fr 2vh;
  width: 100vw;
  height: 100vh;
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
  width: 2vw;
  text-align: center;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #666;
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
  padding: 0 8px;
  gap: 8px;
}

.playbar-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.playbar-btn {
  width: 1.5vh;
  height: 1.5vh;
  min-width: 18px;
  min-height: 18px;
  border: none;
  background: transparent;
  color: #888;
  font-size: 10px;
  cursor: pointer;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  position: relative;
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
  height: 16px;
  background: #222;
  border-radius: 4px;
  position: relative;
  cursor: pointer;
  overflow: hidden;
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
`;

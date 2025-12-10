export const styles = /*css*/ `
/* Reset for shadow DOM */
* {
  box-sizing: border-box;
}

/* Layout */
.fullscreen {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
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

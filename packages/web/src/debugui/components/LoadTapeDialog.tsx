import { useRef, useEffect, useCallback, useState } from "preact/hooks";
import { debugState } from "../state.ts";

export function LoadTapeDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const isOpen = debugState.isLoadDialogOpen.value;
  const lastTapeName = debugState.lastTapeName.value;

  // Sync dialog open/close with signal
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Handle escape key closing dialog
  const handleClose = useCallback(() => {
    debugState.isLoadDialogOpen.value = false;
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.name.endsWith(".bloop")) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    debugState.onLoadTape.value?.(bytes, file.name);
  }, []);

  const handleDropZoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: { currentTarget: HTMLInputElement }) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      if (file) {
        handleFileSelect(file);
        input.value = ""; // Reset for next selection
      }
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback(
    (e: { preventDefault: () => void; dataTransfer: DataTransfer | null }) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    },
    [],
  );

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: { preventDefault: () => void; dataTransfer: DataTransfer | null }) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer?.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  const handleReplayLast = useCallback(() => {
    debugState.onReplayLastTape.value?.();
  }, []);

  return (
    <dialog ref={dialogRef} className="load-tape-dialog" onClose={handleClose}>
      <div className="load-tape-dialog-content">
        <h3>Load Tape</h3>
        <div
          className={`drop-zone ${isDragOver ? "drag-over" : ""}`}
          onClick={handleDropZoneClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <span className="drop-zone-text">
            Drop .bloop file here
            <br />
            or click to browse
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".bloop"
          className="hidden-file-input"
          onChange={handleFileInputChange}
        />
        {lastTapeName && (
          <button className="replay-last-btn" onClick={handleReplayLast}>
            Replay last: {lastTapeName}
          </button>
        )}
      </div>
    </dialog>
  );
}

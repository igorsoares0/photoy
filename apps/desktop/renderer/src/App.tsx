import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from './store/editor';
import { AdjustmentsPanel } from './components/AdjustmentsPanel';
import { Canvas } from './components/Canvas';
import { CropOverlay } from './components/CropOverlay';
import { EmptyState } from './components/EmptyState';
import { ExportDialog } from './components/ExportDialog';
import { Notices } from './components/Notices';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { ToolRail } from './components/ToolRail';
import { ZoomHud } from './components/ZoomHud';

export function App(): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(false);

  const document = useEditor((state) => state.document);
  const openDialog = useEditor((state) => state.openDialog);
  const openPath = useEditor((state) => state.openPath);
  const setEngineState = useEditor((state) => state.setEngineState);
  const setViewport = useEditor((state) => state.setViewport);
  const fitToViewport = useEditor((state) => state.fitToViewport);
  const zoomAt = useEditor((state) => state.zoomAt);
  const undo = useEditor((state) => state.undo);
  const redo = useEditor((state) => state.redo);
  const applyEdit = useEditor((state) => state.applyEdit);
  const cropping = useEditor((state) => state.cropRect !== null);
  const beginCrop = useEditor((state) => state.beginCrop);
  const confirmCrop = useEditor((state) => state.confirmCrop);
  const cancelCrop = useEditor((state) => state.cancelCrop);

  useEffect(() => {
    const stopState = window.photoy.onEngineStateChanged(setEngineState);
    const stopOpen = window.photoy.onOpenRequested((path) => void openPath(path));

    // Pushed events only cover what happens from here on, so pull whatever the
    // main process already settled before this component existed.
    void window.photoy.bootstrap().then((session) => {
      if (!session.ok) return;
      setEngineState(session.value.engineState);
      if (session.value.pendingOpenPath !== null) void openPath(session.value.pendingOpenPath);
    });

    return () => {
      stopState();
      stopOpen();
    };
  }, [setEngineState, openPath]);

  const fit = useCallback(() => {
    const box = stageRef.current?.getBoundingClientRect();
    if (box !== undefined) fitToViewport(box.width, box.height);
  }, [fitToViewport]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const accel = event.ctrlKey || event.metaKey;
      if (accel && event.key === 'o') {
        event.preventDefault();
        void openDialog();
        return;
      }
      if (accel && event.key === 'e' && document !== null) {
        event.preventDefault();
        setExporting(true);
        return;
      }
      if (document === null) return;

      // While the crop tool is open it owns Enter and Escape: the frame is a
      // pending decision, and those are the two answers to it.
      if (cropping) {
        if (event.key === 'Enter') {
          event.preventDefault();
          void confirmCrop();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelCrop();
          return;
        }
      }
      if (!accel && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        cropping ? cancelCrop() : beginCrop();
        return;
      }
      if (accel && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        // Shift turns undo into redo, which is what every editor on this
        // platform does; Ctrl+Y is offered as well out of habit.
        void (event.shiftKey ? redo() : undo());
        return;
      }
      if (accel && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        void redo();
        return;
      }
      if (accel && event.key === '[') {
        event.preventDefault();
        void applyEdit({ kind: 'rotate', quarters: 3 });
        return;
      }
      if (accel && event.key === ']') {
        event.preventDefault();
        void applyEdit({ kind: 'rotate', quarters: 1 });
        return;
      }
      if (accel && event.key === '0') {
        event.preventDefault();
        fit();
      } else if (accel && event.key === '1') {
        event.preventDefault();
        setViewport({ scale: 1, offsetX: 0, offsetY: 0 });
      } else if (accel && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        zoomAt(1.25, 0, 0);
      } else if (accel && event.key === '-') {
        event.preventDefault();
        zoomAt(1 / 1.25, 0, 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    document,
    openDialog,
    fit,
    setViewport,
    zoomAt,
    undo,
    redo,
    applyEdit,
    cropping,
    beginCrop,
    confirmCrop,
    cancelCrop,
  ]);

  // Drag and drop. The path is resolved in the preload and re-validated in the
  // main process before it ever reaches the engine.
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files.item(0);
      if (file === null) return;
      const path = window.photoy.pathForFile(file);
      if (path !== null) void openPath(path);
    },
    [openPath],
  );

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: 'var(--surface-app)' }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <TitleBar onExport={() => setExporting(true)} />

      <div className="flex min-h-0 flex-1">
        <ToolRail />
        <div ref={stageRef} className="relative flex min-h-0 min-w-0 flex-1">
          <Canvas />
          <CropOverlay container={stageRef} />
          {document === null ? (
            <EmptyState dragging={dragging} />
          ) : (
            <ZoomHud viewportRef={stageRef} />
          )}
          <Notices />
          {exporting ? <ExportDialog onClose={() => setExporting(false)} /> : null}
        </div>
        <AdjustmentsPanel />
      </div>

      <StatusBar />
    </div>
  );
}

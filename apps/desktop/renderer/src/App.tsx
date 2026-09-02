import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from './store/editor';
import { useLibrary } from './store/library';
import { AdjustmentsPanel } from './components/AdjustmentsPanel';
import { Canvas } from './components/Canvas';
import { CropOverlay } from './components/CropOverlay';
import { BrushOverlay } from './components/BrushOverlay';
import { MaskOverlay } from './components/MaskOverlay';
import { BatchDialog } from './components/BatchDialog';
import { EmptyState } from './components/EmptyState';
import { Filmstrip } from './components/Filmstrip';
import { LibraryView } from './components/LibraryView';
import { ExportDialog } from './components/ExportDialog';
import { Notices } from './components/Notices';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { ToolRail } from './components/ToolRail';
import { ZoomHud } from './components/ZoomHud';

export function App(): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [batching, setBatching] = useState(false);
  const [dragging, setDragging] = useState(false);
  /**
   * Which of the two things the window is showing.
   *
   * The library is the home: with nothing open there is nothing to edit, and a
   * folder is what a person has before they have a photograph. Opening one
   * moves here, and the rail moves back.
   */
  const [browsing, setBrowsing] = useState(true);

  const document = useEditor((state) => state.document);
  const folderOpen = useLibrary((state) => state.folder !== null);
  const setProgress = useLibrary((state) => state.setProgress);
  const copyAdjustments = useEditor((state) => state.copyAdjustments);
  const pasteAdjustments = useEditor((state) => state.pasteAdjustments);
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
  const setProjectState = useEditor((state) => state.setProjectState);
  const offerRecovery = useEditor((state) => state.offerRecovery);
  const openProject = useEditor((state) => state.openProject);
  const saveProject = useEditor((state) => state.saveProject);
  const saveProjectAs = useEditor((state) => state.saveProjectAs);

  useEffect(() => {
    const stopState = window.photoy.onEngineStateChanged(setEngineState);
    const stopBatch = window.photoy.onBatchProgress((progress) =>
      setProgress(progress.done, progress.total, progress.current),
    );
    const stopOpen = window.photoy.onOpenRequested((path) => void openPath(path));
    const stopProject = window.photoy.onProjectChanged(setProjectState);

    // Pushed events only cover what happens from here on, so pull whatever the
    // main process already settled before this component existed.
    void window.photoy.bootstrap().then((session) => {
      if (!session.ok) return;
      setEngineState(session.value.engineState);
      offerRecovery(session.value.recovery);
      if (session.value.pendingOpenPath !== null) void openPath(session.value.pendingOpenPath);
    });

    return () => {
      stopState();
      stopOpen();
      stopProject();
      stopBatch();
    };
  }, [setEngineState, openPath, setProjectState, offerRecovery, setProgress]);

  // Opening a photograph is the gesture that leaves the library, wherever it
  // came from: a tile, the recent list, a drop, or the shell.
  useEffect(() => {
    if (document !== null) setBrowsing(false);
  }, [document]);

  const fit = useCallback(() => {
    const box = stageRef.current?.getBoundingClientRect();
    if (box !== undefined) fitToViewport(box.width, box.height);
  }, [fitToViewport]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const accel = event.ctrlKey || event.metaKey;
      if (accel && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void (event.shiftKey ? openProject() : openDialog());
        return;
      }
      if (accel && event.key.toLowerCase() === 's' && document !== null) {
        event.preventDefault();
        void (event.shiftKey ? saveProjectAs() : saveProject());
        return;
      }
      if (accel && event.key === 'e' && document !== null) {
        event.preventDefault();
        setExporting(true);
        return;
      }
      // Copying a look and putting it on the next photograph, which is the
      // gesture a folder of two hundred is edited with.
      if (accel && event.shiftKey && event.key.toLowerCase() === 'c' && document !== null) {
        event.preventDefault();
        copyAdjustments();
        return;
      }
      if (accel && event.shiftKey && event.key.toLowerCase() === 'v' && document !== null) {
        event.preventDefault();
        void pasteAdjustments();
        return;
      }
      if (accel && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        setBrowsing((current) => !current);
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
    openProject,
    saveProject,
    saveProjectAs,
    copyAdjustments,
    pasteAdjustments,
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
        <ToolRail browsing={browsing} onBrowse={() => setBrowsing(!browsing)} />
        {browsing ? (
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <LibraryView onOpenBatch={() => setBatching(true)} />
            <Notices />
            {batching ? <BatchDialog onClose={() => setBatching(false)} /> : null}
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div ref={stageRef} className="relative flex min-h-0 min-w-0 flex-1">
              <Canvas />
              <CropOverlay container={stageRef} />
              <MaskOverlay container={stageRef} />
              <BrushOverlay container={stageRef} />
              {document === null ? (
                <EmptyState dragging={dragging} />
              ) : (
                <ZoomHud viewportRef={stageRef} />
              )}
              <Notices />
              {exporting ? <ExportDialog onClose={() => setExporting(false)} /> : null}
              {batching ? <BatchDialog onClose={() => setBatching(false)} /> : null}
            </div>
            {folderOpen ? <Filmstrip /> : null}
          </div>
        )}
        <AdjustmentsPanel />
      </div>

      <StatusBar />
    </div>
  );
}

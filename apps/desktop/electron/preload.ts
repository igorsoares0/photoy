import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  Channels,
  Events,
  type ApiResult,
  type EngineState,
  type OpenedProject,
  type PhotoyApi,
  type ProjectState,
  type InpaintResult,
  type SegmentResult,
  type SessionBootstrap,
  type StoredMask,
} from '@photoy/ipc';
import type {
  DocumentInfo,
  EditHistory,
  ExportRequest,
  ExportResult,
  Operation,
  Preview,
  PreviewRequest,
} from '@photoy/types';
import type { EngineDescription } from '@photoy/ipc';

/**
 * The complete surface the renderer can reach.
 *
 * Written out call by call rather than forwarded generically: an `invoke(channel, args)`
 * passthrough would hand the renderer every channel the main process ever registers,
 * including ones added later without this file being reviewed.
 */
const api: PhotoyApi = {
  describeEngine: () =>
    ipcRenderer.invoke(Channels.engineDescribe) as Promise<ApiResult<EngineDescription>>,

  openImageDialog: () =>
    ipcRenderer.invoke(Channels.imageOpenDialog) as Promise<ApiResult<DocumentInfo | null>>,

  openImagePath: (filePath: string) =>
    ipcRenderer.invoke(Channels.imageOpenPath, filePath) as Promise<ApiResult<DocumentInfo>>,

  closeImage: (documentId: string) =>
    ipcRenderer.invoke(Channels.imageClose, documentId) as Promise<ApiResult<{ closed: boolean }>>,

  renderPreview: (request: PreviewRequest) =>
    ipcRenderer.invoke(Channels.imageRenderPreview, request) as Promise<ApiResult<Preview>>,

  segment: (documentId: string) =>
    ipcRenderer.invoke(Channels.aiSegment, documentId) as Promise<ApiResult<SegmentResult>>,
  storeMask: (documentId: string, width: number, height: number, coverage: Uint8Array) =>
    ipcRenderer.invoke(Channels.maskStore, documentId, width, height, coverage) as Promise<
      ApiResult<SegmentResult>
    >,
  fetchMask: (documentId: string, raster: number) =>
    ipcRenderer.invoke(Channels.maskFetch, documentId, raster) as Promise<ApiResult<StoredMask>>,
  inpaint: (documentId: string, raster: number) =>
    ipcRenderer.invoke(Channels.aiInpaint, documentId, raster) as Promise<ApiResult<InpaintResult>>,

  applyEdit: (documentId: string, operation: Operation, replaceTop = false) =>
    ipcRenderer.invoke(Channels.editApply, documentId, operation, replaceTop) as Promise<
      ApiResult<EditHistory>
    >,

  undoEdit: (documentId: string) =>
    ipcRenderer.invoke(Channels.editUndo, documentId) as Promise<ApiResult<EditHistory>>,

  redoEdit: (documentId: string) =>
    ipcRenderer.invoke(Channels.editRedo, documentId) as Promise<ApiResult<EditHistory>>,

  seekEdit: (documentId: string, cursor: number) =>
    ipcRenderer.invoke(Channels.editSeek, documentId, cursor) as Promise<ApiResult<EditHistory>>,

  resetEdits: (documentId: string) =>
    ipcRenderer.invoke(Channels.editReset, documentId) as Promise<ApiResult<EditHistory>>,

  readHistory: (documentId: string) =>
    ipcRenderer.invoke(Channels.editHistory, documentId) as Promise<ApiResult<EditHistory>>,

  openProject: () => ipcRenderer.invoke(Channels.projectOpen) as Promise<ApiResult<OpenedProject | null>>,
  saveProject: () => ipcRenderer.invoke(Channels.projectSave) as Promise<ApiResult<ProjectState | null>>,
  saveProjectAs: () =>
    ipcRenderer.invoke(Channels.projectSaveAs) as Promise<ApiResult<ProjectState | null>>,

  takeRecovery: () =>
    ipcRenderer.invoke(Channels.recoveryTake) as Promise<ApiResult<OpenedProject | null>>,
  discardRecovery: () => ipcRenderer.invoke(Channels.recoveryDiscard) as Promise<ApiResult<void>>,

  onProjectChanged: (listener: (state: ProjectState) => void) => {
    const forward = (_event: unknown, state: ProjectState) => listener(state);
    ipcRenderer.on(Events.projectChanged, forward);
    return () => ipcRenderer.off(Events.projectChanged, forward);
  },

  chooseExportPath: (suggestedName: string) =>
    ipcRenderer.invoke(Channels.imageExportDialog, suggestedName) as Promise<ApiResult<string | null>>,

  exportImage: (request: ExportRequest) =>
    ipcRenderer.invoke(Channels.imageExport, request) as Promise<ApiResult<ExportResult>>,

  bootstrap: () =>
    ipcRenderer.invoke(Channels.sessionBootstrap) as Promise<ApiResult<SessionBootstrap>>,

  pathForFile: (file: File) => {
    try {
      const filePath = webUtils.getPathForFile(file);
      return filePath.length > 0 ? filePath : null;
    } catch {
      return null;
    }
  },

  onEngineStateChanged: (listener: (state: EngineState) => void) => {
    const forward = (_event: unknown, state: EngineState) => listener(state);
    ipcRenderer.on(Events.engineStateChanged, forward);
    return () => ipcRenderer.off(Events.engineStateChanged, forward);
  },

  onOpenRequested: (listener: (filePath: string) => void) => {
    const forward = (_event: unknown, filePath: string) => listener(filePath);
    ipcRenderer.on(Events.openRequested, forward);
    return () => ipcRenderer.off(Events.openRequested, forward);
  },
};

contextBridge.exposeInMainWorld('photoy', api);

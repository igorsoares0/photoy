/**
 * Electron IPC channel names. The renderer never sees these directly; the
 * preload script is the only caller, and it exposes a typed facade instead.
 */
export const Channels = {
  engineDescribe: 'photoy:engine.describe',
  imageOpenDialog: 'photoy:image.openDialog',
  imageOpenPath: 'photoy:image.openPath',
  imageClose: 'photoy:image.close',
  imageRenderPreview: 'photoy:image.renderPreview',
  imageExportDialog: 'photoy:image.exportDialog',
  imageExport: 'photoy:image.export',
  editApply: 'photoy:edit.apply',
  editUndo: 'photoy:edit.undo',
  editRedo: 'photoy:edit.redo',
  editSeek: 'photoy:edit.seek',
  editReset: 'photoy:edit.reset',
  editHistory: 'photoy:edit.history',
  projectOpen: 'photoy:project.open',
  projectSave: 'photoy:project.save',
  projectSaveAs: 'photoy:project.saveAs',
  projectState: 'photoy:project.state',
  recoveryTake: 'photoy:recovery.take',
  recoveryDiscard: 'photoy:recovery.discard',
  aiSegment: 'photoy:ai.segment',
  aiDetectFaces: 'photoy:ai.detectFaces',
  maskStore: 'photoy:mask.store',
  maskFetch: 'photoy:mask.fetch',
  aiInpaint: 'photoy:ai.inpaint',
  projectOpenPath: 'photoy:project.openPath',
  imageAnalyse: 'photoy:image.analyse',
  backgroundChoose: 'photoy:background.choose',
  presetList: 'photoy:preset.list',
  presetSave: 'photoy:preset.save',
  presetDelete: 'photoy:preset.delete',
  recentList: 'photoy:recent.list',
  sessionBootstrap: 'photoy:session.bootstrap',
} as const;

/** Main-to-renderer pushes. */
export const Events = {
  engineStateChanged: 'photoy:engine.stateChanged',
  openRequested: 'photoy:shell.openRequested',
  projectChanged: 'photoy:project.changed',
} as const;

export type ChannelName = (typeof Channels)[keyof typeof Channels];
export type EventName = (typeof Events)[keyof typeof Events];

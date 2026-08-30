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
  editReset: 'photoy:edit.reset',
  editHistory: 'photoy:edit.history',
  recentList: 'photoy:recent.list',
  sessionBootstrap: 'photoy:session.bootstrap',
} as const;

/** Main-to-renderer pushes. */
export const Events = {
  engineStateChanged: 'photoy:engine.stateChanged',
  openRequested: 'photoy:shell.openRequested',
} as const;

export type ChannelName = (typeof Channels)[keyof typeof Channels];
export type EventName = (typeof Events)[keyof typeof Events];

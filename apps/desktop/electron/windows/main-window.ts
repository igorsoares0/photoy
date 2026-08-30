import { BrowserWindow, screen, shell } from 'electron';
import path from 'node:path';

const DEV_SERVER_URL = process.env['PHOTOY_DEV_SERVER'];

/**
 * Chrome geometry comes from the style guide: a 46px title bar the app draws
 * itself, so the window controls sit on our own surface instead of a native
 * strip in a different grey.
 */
const TITLEBAR_HEIGHT = 46;

const PREFERRED_WIDTH = 1360;
const PREFERRED_HEIGHT = 860;

/**
 * Fits the preferred size inside the display's work area.
 *
 * Window sizes are in DIPs, so on a scaled display the preferred size can be
 * larger than the screen it has to fit on: 1360 DIP is 1700 physical pixels at
 * 125%, which on a 1536-wide panel puts the export button off the edge.
 */
function initialBounds(): { width: number; height: number } {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.max(900, Math.min(PREFERRED_WIDTH, width - 40)),
    height: Math.max(600, Math.min(PREFERRED_HEIGHT, height - 40)),
  };
}

export function createMainWindow(preloadPath: string): BrowserWindow {
  const bounds = initialBounds();
  const window = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 900,
    minHeight: 600,
    center: true,
    show: false,
    backgroundColor: '#0A0A0B', // --surface-app, so the first paint is not white
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0D0D0F', // --surface-chrome
      symbolColor: '#85858F', // --text-muted
      height: TITLEBAR_HEIGHT,
    },
    webPreferences: {
      preload: preloadPath,
      // The renderer gets no Node and no direct main-process reach: everything
      // it may do is listed explicitly in the preload bridge.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  // Nothing in this app should navigate away or open a second window; anything
  // that tries is either a mistake or an injection, so hand it to the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (DEV_SERVER_URL !== undefined && url.startsWith(DEV_SERVER_URL)) return;
    event.preventDefault();
  });

  if (DEV_SERVER_URL !== undefined) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  return window;
}

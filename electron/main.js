import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PRELOAD_PATH = path.join(ROOT_DIR, 'electron', 'preload.cjs');
const SERVER_ENTRY_URL = pathToFileURL(path.join(ROOT_DIR, 'server', 'index.js')).href;
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL || null;
const FRONTEND_INDEX_PATH = path.join(ROOT_DIR, 'dist', 'index.html');
const WINDOW_STATE_FILE = 'window-state.json';
const DEFAULT_WINDOW_STATE = {
  width: 1440,
  height: 920,
};

let mainWindow = null;
let serverModulePromise = null;

function getWindowStatePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE);
}

function readWindowState() {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      width: Number(parsed.width) || DEFAULT_WINDOW_STATE.width,
      height: Number(parsed.height) || DEFAULT_WINDOW_STATE.height,
      x: Number.isFinite(parsed.x) ? parsed.x : undefined,
      y: Number.isFinite(parsed.y) ? parsed.y : undefined,
    };
  } catch {
    return { ...DEFAULT_WINDOW_STATE };
  }
}

function persistWindowState(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  const bounds = window.getBounds();
  const payload = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
  };

  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(payload, null, 2));
  } catch (error) {
    console.warn('[electron] failed to persist window state:', error.message);
  }
}

async function waitForUrl(url, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok || response.status < 500) {
        return;
      }
    } catch {
      // Poll until the local service is ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function ensureLocalServer() {
  process.env.DESKTOP_RUNTIME = '1';
  process.env.HOST ||= '127.0.0.1';
  process.env.DB_SQLITE_PATH ||= path.join(app.getPath('userData'), 'codexpoolmatrix.sqlite');
  process.env.DESKTOP_ACCOUNTS_DIR ||= path.join(app.getPath('userData'), 'accounts');

  if (!serverModulePromise) {
    serverModulePromise = import(SERVER_ENTRY_URL);
  }

  const serverModule = await serverModulePromise;
  await serverModule.startDesktopRuntime();
  return serverModule;
}

async function proxyApiRequest(_event, payload = {}) {
  const serverModule = await ensureLocalServer();
  return serverModule.invokeApiRequest(payload);
}

async function createMainWindow() {
  await ensureLocalServer();
  const savedWindowState = readWindowState();

  mainWindow = new BrowserWindow({
    width: savedWindowState.width,
    height: savedWindowState.height,
    x: savedWindowState.x,
    y: savedWindowState.y,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0f172a',
    title: 'CodexPoolMatrix',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://') || url.startsWith('http://localhost:8080')) {
      return;
    }
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  if (RENDERER_URL) {
    await waitForUrl(RENDERER_URL);
    await mainWindow.loadURL(RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(FRONTEND_INDEX_PATH);
  }

  if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[electron] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });

  mainWindow.on('resize', () => {
    persistWindowState(mainWindow);
  });

  mainWindow.on('move', () => {
    persistWindowState(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    app.setName('CodexPoolMatrix');
    app.setAboutPanelOptions({
      applicationName: 'CodexPoolMatrix',
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
    });

    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
      await app.quit();
      return;
    }

    app.on('second-instance', () => {
      if (!mainWindow) {
        return;
      }
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    });

    ipcMain.handle('codexpool:api-request', proxyApiRequest);
    await createMainWindow();
  } catch (error) {
    dialog.showErrorBox('CodexPoolMatrix 启动失败', error.message);
    await app.quit();
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  persistWindowState(mainWindow);
});

app.on('before-quit', async () => {
  ipcMain.removeHandler('codexpool:api-request');

  if (!serverModulePromise) {
    return;
  }

  try {
    const serverModule = await serverModulePromise;
    await serverModule.stopServer();
  } catch {
    // Best effort shutdown.
  }
});

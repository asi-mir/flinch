'use strict';
const { app, BrowserWindow, ipcMain, session, dialog, safeStorage, webContents, systemPreferences, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store');
const notes = require('./notes');

const ROOT = path.join(__dirname, '..', '..');
const WEBVIEW_PRELOAD = path.join(ROOT, 'src', 'preload', 'webview-preload.js');
const TEST_PARTITION = 'flinch-test'; // in memory only: cookies of the tested site never touch the disk
const SIMULATE = process.argv.includes('--simulate') || process.env.FLINCH_SIMULATE === '1';

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env file: the key can be entered in the app instead.
}

let mainWindow = null;
let store = null;

// ---- SmartSpectra API key -------------------------------------------------

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readSavedKey() {
  try {
    const { apiKey } = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    if (!apiKey) return '';
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(apiKey, 'base64')) : '';
  } catch {
    return '';
  }
}

function getApiKey() {
  return process.env.SMARTSPECTRA_API_KEY || readSavedKey();
}

function saveApiKey(key) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer cannot encrypt the key. Use a .env file instead.');
  const apiKey = key ? safeStorage.encryptString(key).toString('base64') : '';
  fs.writeFileSync(configFile(), JSON.stringify({ apiKey }));
}

// ---- Window ---------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Flinch',
    backgroundColor: '#f6f5f2',
    webPreferences: {
      preload: path.join(ROOT, 'dist', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      // A test must keep its timing even when the window is covered.
      backgroundThrottling: false,
    },
  });

  if (!SIMULATE) {
    try {
      // Loads the native SmartSpectra runtime and connects it to this window.
      const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');
      bindSmartSpectraIpc(mainWindow, {
        logger: (level, msg) => {
          if (level !== 'info') console[level](`[smartspectra] ${msg}`);
        },
      });
    } catch (err) {
      console.error('[smartspectra] could not load the SDK:', err.message);
    }
  }

  mainWindow.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function fromMainWindow(event) {
  return mainWindow && event.sender === mainWindow.webContents;
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromMainWindow(event)) throw new Error('Not allowed');
    return fn(...args);
  });
}

// ---- Security: the tested site is untrusted content -------------------------

function lockDown() {
  // The camera goes to Flinch's own window only. The tested site gets nothing.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media' && !!mainWindow && wc === mainWindow.webContents);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return permission === 'media' && !!mainWindow && wc === mainWindow.webContents;
  });
  const testSession = session.fromPartition(TEST_PARTITION);
  testSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  testSession.setPermissionCheckHandler(() => false);

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Only our own preload may run in the tested page, and never with Node access.
      webPreferences.preload = WEBVIEW_PRELOAD;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      if (params.partition !== TEST_PARTITION) event.preventDefault();
    });
    if (contents.getType() === 'webview') {
      // Links that want a new window open in the same view, so the test stays in one place.
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/.test(url)) contents.loadURL(url);
        return { action: 'deny' };
      });
    } else {
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https:/.test(url)) shell.openExternal(url);
        return { action: 'deny' };
      });
      contents.on('will-navigate', (event) => event.preventDefault());
    }
  });
}

// ---- IPC --------------------------------------------------------------------

function registerIpc() {
  handle('app:info', () => ({
    simulate: SIMULATE,
    hasKey: !!getApiKey(),
    aiNotes: notes.available(),
    keyFromEnv: !!process.env.SMARTSPECTRA_API_KEY,
    demoUrl: pathToFileURL(path.join(ROOT, 'demo-site', 'index.html')).href,
    webviewPreload: pathToFileURL(WEBVIEW_PRELOAD).href,
    partition: TEST_PARTITION,
    version: app.getVersion(),
    dataDir: store.root,
  }));

  handle('key:get', () => getApiKey());
  handle('key:set', (key) => {
    saveApiKey(String(key || '').trim());
    return !!getApiKey();
  });

  handle('camera:access', async () => {
    if (process.platform !== 'darwin') return true;
    if (systemPreferences.getMediaAccessStatus('camera') === 'granted') return true;
    return systemPreferences.askForMediaAccess('camera');
  });

  handle('sessions:list', () => store.list());
  handle('sessions:create', async () => {
    // Every test starts with a clean browser: no cookies or logins from the last tester.
    await session.fromPartition(TEST_PARTITION).clearStorageData();
    return store.create();
  });
  handle('sessions:save', (id, data) => store.save(id, data));
  handle('sessions:load', (id) => {
    const { data, shotsDir } = store.load(id);
    return { data, shotsUrl: pathToFileURL(shotsDir).href };
  });
  handle('sessions:delete', (id) => store.remove(id));
  handle('sessions:deleteAll', () => store.removeAll());

  // Screenshots show the tested page only. The camera image is never captured.
  handle('shots:capture', async (id, webContentsId, t) => {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.getType() !== 'webview') return null;
    // capturePage can fail while the page is navigating. One missing screenshot is fine.
    const image = await wc.capturePage().catch(() => null);
    if (!image || image.isEmpty()) return null;
    const { width } = image.getSize();
    const small = width > 1100 ? image.resize({ width: 1100, quality: 'good' }) : image;
    return store.saveShot(id, t, small.toJPEG(62));
  });

  // Optional: Claude explains the moments. Runs only when the person presses the button.
  handle('notes:write', async (id) => {
    const { data, shotsDir } = store.load(id);
    data.notes = await notes.writeNotes(data, shotsDir);
    store.save(id, data);
    return data.notes;
  });

  handle('export:save', async (name, text) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: name,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, text);
    return true;
  });
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  lockDown();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

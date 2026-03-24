import { app, BrowserWindow, shell, ipcMain, safeStorage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { decryptCDCContainer, decryptPayloadWithKey } from './crypto.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// --- DRM IPC Handlers ---

const SECURE_DATA_PATH = path.join(app.getPath('userData'), 'secure_metadata.json');
const DOCUMENTS_LIST_PATH = path.join(app.getPath('userData'), 'documents.json');
const STORED_DOCS_DIR = path.join(app.getPath('userData'), 'stored_docs');

// Create stored_docs directory if it doesn't exist
if (!fs.existsSync(STORED_DOCS_DIR)) {
  fs.mkdirSync(STORED_DOCS_DIR, { recursive: true });
}

function readSecureMetadata() {
  if (!fs.existsSync(SECURE_DATA_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SECURE_DATA_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeSecureMetadata(data: any) {
  fs.writeFileSync(SECURE_DATA_PATH, JSON.stringify(data, null, 2));
}

// Handler to save the document list
ipcMain.handle('docs:save-list', async (_event, documents) => {
  try {
    fs.writeFileSync(DOCUMENTS_LIST_PATH, JSON.stringify(documents, null, 2));
    return true;
  } catch (error) {
    console.error('Failed to save document list:', error);
    return false;
  }
});

// Handler to load the document list
ipcMain.handle('docs:load-list', async () => {
  try {
    if (!fs.existsSync(DOCUMENTS_LIST_PATH)) return [];
    const data = fs.readFileSync(DOCUMENTS_LIST_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load document list:', error);
    return [];
  }
});

// Handler to save an imported file locally
ipcMain.handle('docs:save-file-locally', async (_event, docId, fileName, arrayBuffer) => {
  try {
    const fileExt = path.extname(fileName);
    const localPath = path.join(STORED_DOCS_DIR, `${docId}${fileExt}`);
    fs.writeFileSync(localPath, Buffer.from(arrayBuffer));
    return localPath;
  } catch (error) {
    console.error('Failed to save file locally:', error);
    throw error;
  }
});

// Handler to read a local file
ipcMain.handle('docs:read-local-file', async (_event, localPath) => {
  try {
    if (!fs.existsSync(localPath)) throw new Error('File not found');
    return fs.readFileSync(localPath);
  } catch (error) {
    console.error('Failed to read local file:', error);
    throw error;
  }
});

// Handler to decrypt the CDC container using passKey
ipcMain.handle('drm:decrypt-cdc', async (_event, container, passKey) => {
  try {
    return await decryptCDCContainer(container, passKey);
  } catch (error: any) {
    console.error('Decryption failed:', error);
    throw new Error(`Decryption failed: ${error.message}`);
  }
});

// Handler to decrypt payload using already unwrapped contentKey
ipcMain.handle('drm:decrypt-payload', async (_event, container, contentKey) => {
  try {
    return await decryptPayloadWithKey(container, contentKey);
  } catch (error: any) {
    console.error('Payload decryption failed:', error);
    throw new Error(`Payload decryption failed: ${error.message}`);
  }
});

// Secure storage handlers using Electron's safeStorage
ipcMain.handle('secure:set-data', async (_event, docId, key, value) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Safe storage is not available on this system');
  }

  const encrypted = safeStorage.encryptString(value);
  const metadata = readSecureMetadata();
  
  if (!metadata[docId]) metadata[docId] = {};
  metadata[docId][key] = encrypted.toString('base64');
  
  writeSecureMetadata(metadata);
  return true;
});

ipcMain.handle('secure:get-data', async (_event, docId, key) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Safe storage is not available on this system');
  }

  const metadata = readSecureMetadata();
  const encryptedBase64 = metadata[docId]?.[key];
  
  if (!encryptedBase64) return null;
  
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'));
    return decrypted;
  } catch (error) {
    console.error(`Failed to decrypt ${key} for ${docId}:`, error);
    return null;
  }
});

ipcMain.handle('secure:remove-doc-data', async (_event, docId) => {
  const metadata = readSecureMetadata();
  if (metadata[docId]) {
    delete metadata[docId];
    writeSecureMetadata(metadata);
    return true;
  }
  return false;
});

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    icon: path.join(process.env.VITE_PUBLIC!, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)
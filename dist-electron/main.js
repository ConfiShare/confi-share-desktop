import * as electron from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
function unwrapKeyWithPass(wrappedData, derivedKey) {
  try {
    const obj = typeof wrappedData === "string" ? JSON.parse(wrappedData) : wrappedData;
    if (typeof obj !== "object" || obj === null) {
      throw new Error("Invalid wrappedKey structure");
    }
    const wrappedObj = obj;
    const ivValue = typeof wrappedObj.iv === "string" ? wrappedObj.iv : wrappedObj.wrappedIv;
    const tagValue = typeof wrappedObj.tag === "string" ? wrappedObj.tag : wrappedObj.authTag;
    const wrappedValue = typeof wrappedObj.wrapped === "string" ? wrappedObj.wrapped : typeof wrappedObj.ciphertext === "string" ? wrappedObj.ciphertext : wrappedObj.encryptedKey;
    if (typeof ivValue !== "string" || typeof tagValue !== "string" || typeof wrappedValue !== "string") {
      throw new Error("Invalid wrappedKey fields");
    }
    const iv = Buffer.from(ivValue, "base64");
    const tag = Buffer.from(tagValue, "base64");
    const wrapped = Buffer.from(wrappedValue, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown unwrap error";
    console.error("unwrapKeyWithPass failed:", message);
    throw err;
  }
}
function aesGcmDecrypt(encryptedData, key, iv, tag) {
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown decrypt error";
    console.error("aesGcmDecrypt failed:", message);
    throw err;
  }
}
async function decryptCDCContainer(container, passKey) {
  if (typeof container !== "object" || container === null) {
    throw new Error("Invalid container format");
  }
  const containerObj = container;
  const metaValue = containerObj.meta;
  if (typeof metaValue !== "object" || metaValue === null) {
    throw new Error("Invalid container metadata");
  }
  const meta = metaValue;
  const payloadValue = containerObj.payload;
  if (typeof payloadValue !== "string") {
    throw new Error("Invalid container payload");
  }
  if (typeof meta.iv !== "string" || typeof meta.tag !== "string") {
    throw new Error("Invalid container crypto metadata");
  }
  const passKeyHash = crypto.createHash("sha256").update(passKey).digest("hex");
  const saltString = typeof meta.salt === "string" ? meta.salt : String(meta.salt ?? "");
  const saltBase64 = Buffer.from(saltString, "base64");
  const saltBase64Url = Buffer.from(saltString, "base64url");
  const variations = [
    { name: "Raw PassKey + String Salt", p: passKey, s: saltString },
    { name: "Raw PassKey + Base64 Salt", p: passKey, s: saltBase64 },
    { name: "Raw PassKey + Base64url Salt", p: passKey, s: saltBase64Url },
    { name: "Hashed PassKey + String Salt", p: passKeyHash, s: saltString },
    { name: "Hashed PassKey + Base64 Salt", p: passKeyHash, s: saltBase64 },
    { name: "Hashed PassKey + Base64url Salt", p: passKeyHash, s: saltBase64Url }
  ];
  let lastError = null;
  for (const variation of variations) {
    try {
      const derivedKey = crypto.pbkdf2Sync(variation.p, variation.s, 1e5, 32, "sha256");
      const contentKey = unwrapKeyWithPass(meta.wrappedKey, derivedKey);
      const fileIv = Buffer.from(meta.iv, "base64");
      const fileTag = Buffer.from(meta.tag, "base64");
      const encryptedPayload = Buffer.from(payloadValue, "base64");
      const decryptedBuffer = aesGcmDecrypt(encryptedPayload, contentKey, fileIv, fileTag);
      console.log(`Successfully decrypted using ${variation.name}`);
      return {
        decryptedPayload: decryptedBuffer.toString("utf8"),
        contentKey: contentKey.toString("base64")
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown variation error";
      console.error(`${variation.name} failed:`, message);
      lastError = error;
    }
  }
  const lastMessage = lastError instanceof Error ? lastError.message : "Unknown decryption error";
  throw new Error(`Decryption failed: All variations failed. Last error: ${lastMessage}`);
}
async function decryptPayloadWithKey(container, contentKeyBase64) {
  if (typeof container !== "object" || container === null) {
    throw new Error("Invalid container format");
  }
  const containerObj = container;
  const metaValue = containerObj.meta;
  if (typeof metaValue !== "object" || metaValue === null) {
    throw new Error("Invalid container metadata");
  }
  const meta = metaValue;
  const payloadValue = containerObj.payload;
  if (typeof payloadValue !== "string") {
    throw new Error("Invalid container payload");
  }
  if (typeof meta.iv !== "string" || typeof meta.tag !== "string") {
    throw new Error("Invalid container crypto metadata");
  }
  const contentKey = Buffer.from(contentKeyBase64, "base64");
  const fileIv = Buffer.from(meta.iv, "base64");
  const fileTag = Buffer.from(meta.tag, "base64");
  const encryptedPayload = Buffer.from(payloadValue, "base64");
  const decryptedBuffer = aesGcmDecrypt(encryptedPayload, contentKey, fileIv, fileTag);
  return decryptedBuffer.toString("utf8");
}
const { app, BrowserWindow, shell, ipcMain, safeStorage, session } = electron;
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
const SECURE_DATA_PATH = path.join(app.getPath("userData"), "secure_metadata.json");
const DOCUMENTS_LIST_PATH = path.join(app.getPath("userData"), "documents.json");
const STORED_DOCS_DIR = path.join(app.getPath("userData"), "stored_docs");
if (!fs.existsSync(STORED_DOCS_DIR)) {
  fs.mkdirSync(STORED_DOCS_DIR, { recursive: true });
}
function readSecureMetadata() {
  if (!fs.existsSync(SECURE_DATA_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SECURE_DATA_PATH, "utf-8"));
  } catch {
    return {};
  }
}
function writeSecureMetadata(data) {
  fs.writeFileSync(SECURE_DATA_PATH, JSON.stringify(data, null, 2));
}
ipcMain.handle("docs:save-list", async (_event, documents) => {
  try {
    fs.writeFileSync(DOCUMENTS_LIST_PATH, JSON.stringify(documents, null, 2));
    return true;
  } catch (error) {
    console.error("Failed to save document list:", error);
    return false;
  }
});
ipcMain.handle("docs:load-list", async () => {
  try {
    if (!fs.existsSync(DOCUMENTS_LIST_PATH)) return [];
    const data = fs.readFileSync(DOCUMENTS_LIST_PATH, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Failed to load document list:", error);
    return [];
  }
});
ipcMain.handle("docs:save-file-locally", async (_event, docId, fileName, arrayBuffer) => {
  try {
    const fileExt = path.extname(fileName);
    const localPath = path.join(STORED_DOCS_DIR, `${docId}${fileExt}`);
    fs.writeFileSync(localPath, Buffer.from(arrayBuffer));
    return localPath;
  } catch (error) {
    console.error("Failed to save file locally:", error);
    throw error;
  }
});
ipcMain.handle("docs:read-local-file", async (_event, localPath) => {
  try {
    if (!fs.existsSync(localPath)) throw new Error("File not found");
    return fs.readFileSync(localPath);
  } catch (error) {
    console.error("Failed to read local file:", error);
    throw error;
  }
});
ipcMain.handle("drm:decrypt-cdc", async (_event, container, passKey) => {
  try {
    return await decryptCDCContainer(container, passKey);
  } catch (error) {
    console.error("Decryption failed:", error);
    throw new Error(`Decryption failed: ${error.message}`);
  }
});
ipcMain.handle("drm:decrypt-payload", async (_event, container, contentKey) => {
  try {
    return await decryptPayloadWithKey(container, contentKey);
  } catch (error) {
    console.error("Payload decryption failed:", error);
    throw new Error(`Payload decryption failed: ${error.message}`);
  }
});
ipcMain.handle("secure:set-data", async (_event, docId, key, value) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Safe storage is not available on this system");
  }
  const encrypted = safeStorage.encryptString(value);
  const metadata = readSecureMetadata();
  if (!metadata[docId]) metadata[docId] = {};
  metadata[docId][key] = encrypted.toString("base64");
  writeSecureMetadata(metadata);
  return true;
});
ipcMain.handle("secure:get-data", async (_event, docId, key) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Safe storage is not available on this system");
  }
  const metadata = readSecureMetadata();
  const encryptedBase64 = metadata[docId]?.[key];
  if (!encryptedBase64) return null;
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(encryptedBase64, "base64"));
    return decrypted;
  } catch (error) {
    console.error(`Failed to decrypt ${key} for ${docId}:`, error);
    return null;
  }
});
ipcMain.handle("secure:remove-doc-data", async (_event, docId) => {
  const metadata = readSecureMetadata();
  if (metadata[docId]) {
    delete metadata[docId];
    writeSecureMetadata(metadata);
    return true;
  }
  return false;
});
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
const APP_ICON_PATH = path.join(process.env.VITE_PUBLIC, "app-icon.png");
function isBlockedShortcut(input) {
  const isZoomShortcut = (input.control || input.meta) && ["Equal", "NumpadAdd", "Minus", "NumpadSubtract", "Digit0", "Numpad0"].includes(input.code);
  const isPrintShortcut = (input.control || input.meta) && input.code === "KeyP";
  const isSaveOrDownloadShortcut = (input.control || input.meta) && input.code === "KeyS";
  return isZoomShortcut || isPrintShortcut || isSaveOrDownloadShortcut;
}
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#ffffff",
    show: false,
    // Don't show the window until it's ready to avoid white screen
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setContentProtection(false);
  win.webContents.setZoomFactor(1);
  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
  });
  win.webContents.on("zoom-changed", (event) => {
    event.preventDefault();
    win?.webContents.setZoomFactor(1);
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && isBlockedShortcut(input)) {
      event.preventDefault();
    }
  });
  win.webContents.on("context-menu", (event) => {
    event.preventDefault();
  });
  win.once("ready-to-show", () => {
    win?.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(() => {
  session.defaultSession.on("will-download", (event) => {
    event.preventDefault();
  });
  createWindow();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
//# sourceMappingURL=main.js.map

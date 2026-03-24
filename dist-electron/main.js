import { app, ipcMain, safeStorage, BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
function unwrapKeyWithPass(wrappedData, derivedKey) {
  try {
    const obj = typeof wrappedData === "string" ? JSON.parse(wrappedData) : wrappedData;
    const iv = Buffer.from(obj.iv, "base64");
    const tag = Buffer.from(obj.tag, "base64");
    const wrapped = Buffer.from(obj.wrapped, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  } catch (err) {
    console.error("unwrapKeyWithPass failed:", err.message);
    throw err;
  }
}
function aesGcmDecrypt(encryptedData, key, iv, tag) {
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  } catch (err) {
    console.error("aesGcmDecrypt failed:", err.message);
    throw err;
  }
}
async function decryptCDCContainer(container, passKey) {
  const { meta } = container;
  const passKeyHash = crypto.createHash("sha256").update(passKey).digest("hex");
  const variations = [
    { name: "Raw PassKey + String Salt", p: passKey, s: meta.salt },
    { name: "Raw PassKey + Buffer Salt", p: passKey, s: Buffer.from(meta.salt, "base64") },
    { name: "Hashed PassKey + String Salt", p: passKeyHash, s: meta.salt },
    { name: "Hashed PassKey + Buffer Salt", p: passKeyHash, s: Buffer.from(meta.salt, "base64") }
  ];
  for (const v of variations) {
    try {
      const derivedKey = crypto.pbkdf2Sync(v.p, v.s, 1e5, 32, "sha256");
      const contentKey = unwrapKeyWithPass(meta.wrappedKey, derivedKey);
      const fileIv = Buffer.from(meta.iv, "base64");
      const fileTag = Buffer.from(meta.tag, "base64");
      const encryptedPayload = Buffer.from(container.payload, "base64");
      const decryptedBuffer = aesGcmDecrypt(encryptedPayload, contentKey, fileIv, fileTag);
      console.log(`✅ Successfully decrypted using ${v.name}`);
      return {
        decryptedPayload: decryptedBuffer.toString("utf8"),
        contentKey: contentKey.toString("base64")
      };
    } catch (error) {
      console.error(`❌ ${v.name} failed:`, error.message);
    }
  }
  throw new Error(`Decryption failed: All 4 variations failed. Check terminal logs for details.`);
}
async function decryptPayloadWithKey(container, contentKeyBase64) {
  const { meta, payload } = container;
  const contentKey = Buffer.from(contentKeyBase64, "base64");
  const fileIv = Buffer.from(meta.iv, "base64");
  const fileTag = Buffer.from(meta.tag, "base64");
  const encryptedPayload = Buffer.from(payload, "base64");
  const decryptedBuffer = aesGcmDecrypt(encryptedPayload, contentKey, fileIv, fileTag);
  return decryptedBuffer.toString("utf8");
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
const SECURE_DATA_PATH = path.join(app.getPath("userData"), "secure_metadata.json");
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
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#ffffff",
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
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
app.whenReady().then(createWindow);
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
//# sourceMappingURL=main.js.map

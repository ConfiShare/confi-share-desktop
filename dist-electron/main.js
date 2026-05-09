import * as U from "electron";
import { fileURLToPath as N } from "node:url";
import c from "node:path";
import i from "node:fs";
import v from "node:crypto";
function H(e, r) {
  try {
    const t = typeof e == "string" ? JSON.parse(e) : e;
    if (typeof t != "object" || t === null)
      throw new Error("Invalid wrappedKey structure");
    const n = t, o = typeof n.iv == "string" ? n.iv : n.wrappedIv, a = typeof n.tag == "string" ? n.tag : n.authTag, f = typeof n.wrapped == "string" ? n.wrapped : typeof n.ciphertext == "string" ? n.ciphertext : n.encryptedKey;
    if (typeof o != "string" || typeof a != "string" || typeof f != "string")
      throw new Error("Invalid wrappedKey fields");
    const d = Buffer.from(o, "base64"), p = Buffer.from(a, "base64"), u = Buffer.from(f, "base64"), m = v.createDecipheriv("aes-256-gcm", r, d);
    return m.setAuthTag(p), Buffer.concat([m.update(u), m.final()]);
  } catch (t) {
    const n = t instanceof Error ? t.message : "Unknown unwrap error";
    throw console.error("unwrapKeyWithPass failed:", n), t;
  }
}
function I(e, r, t, n) {
  try {
    const o = v.createDecipheriv("aes-256-gcm", r, t);
    return o.setAuthTag(n), Buffer.concat([o.update(e), o.final()]);
  } catch (o) {
    const a = o instanceof Error ? o.message : "Unknown decrypt error";
    throw console.error("aesGcmDecrypt failed:", a), o;
  }
}
async function L(e, r) {
  if (typeof e != "object" || e === null)
    throw new Error("Invalid container format");
  const t = e, n = t.meta;
  if (typeof n != "object" || n === null)
    throw new Error("Invalid container metadata");
  const o = n, a = t.payload;
  if (typeof a != "string")
    throw new Error("Invalid container payload");
  if (typeof o.iv != "string" || typeof o.tag != "string")
    throw new Error("Invalid container crypto metadata");
  const f = v.createHash("sha256").update(r).digest("hex"), d = typeof o.salt == "string" ? o.salt : String(o.salt ?? ""), p = Buffer.from(d, "base64"), u = Buffer.from(d, "base64url"), m = [
    { name: "Raw PassKey + String Salt", p: r, s: d },
    { name: "Raw PassKey + Base64 Salt", p: r, s: p },
    { name: "Raw PassKey + Base64url Salt", p: r, s: u },
    { name: "Hashed PassKey + String Salt", p: f, s: d },
    { name: "Hashed PassKey + Base64 Salt", p: f, s: p },
    { name: "Hashed PassKey + Base64url Salt", p: f, s: u }
  ];
  let E = null;
  for (const w of m)
    try {
      const h = v.pbkdf2Sync(w.p, w.s, 1e5, 32, "sha256"), g = H(o.wrappedKey, h), K = Buffer.from(o.iv, "base64"), V = Buffer.from(o.tag, "base64"), F = Buffer.from(a, "base64"), x = I(F, g, K, V);
      return console.log(`Successfully decrypted using ${w.name}`), {
        decryptedPayload: x.toString("utf8"),
        contentKey: g.toString("base64")
      };
    } catch (h) {
      const g = h instanceof Error ? h.message : "Unknown variation error";
      console.error(`${w.name} failed:`, g), E = h;
    }
  const C = E instanceof Error ? E.message : "Unknown decryption error";
  throw new Error(`Decryption failed: All variations failed. Last error: ${C}`);
}
async function $(e, r) {
  if (typeof e != "object" || e === null)
    throw new Error("Invalid container format");
  const t = e, n = t.meta;
  if (typeof n != "object" || n === null)
    throw new Error("Invalid container metadata");
  const o = n, a = t.payload;
  if (typeof a != "string")
    throw new Error("Invalid container payload");
  if (typeof o.iv != "string" || typeof o.tag != "string")
    throw new Error("Invalid container crypto metadata");
  const f = Buffer.from(r, "base64"), d = Buffer.from(o.iv, "base64"), p = Buffer.from(o.tag, "base64"), u = Buffer.from(a, "base64");
  return I(u, f, d, p).toString("utf8");
}
const { app: y, BrowserWindow: j, shell: W, ipcMain: l, safeStorage: S, session: k } = U, T = c.dirname(N(import.meta.url)), b = c.join(y.getPath("userData"), "secure_metadata.json"), P = c.join(y.getPath("userData"), "documents.json"), _ = c.join(y.getPath("userData"), "stored_docs");
i.existsSync(_) || i.mkdirSync(_, { recursive: !0 });
function D() {
  if (!i.existsSync(b)) return {};
  try {
    return JSON.parse(i.readFileSync(b, "utf-8"));
  } catch {
    return {};
  }
}
function O(e) {
  i.writeFileSync(b, JSON.stringify(e, null, 2));
}
l.handle("docs:save-list", async (e, r) => {
  try {
    return i.writeFileSync(P, JSON.stringify(r, null, 2)), !0;
  } catch (t) {
    return console.error("Failed to save document list:", t), !1;
  }
});
l.handle("docs:load-list", async () => {
  try {
    if (!i.existsSync(P)) return [];
    const e = i.readFileSync(P, "utf-8");
    return JSON.parse(e);
  } catch (e) {
    return console.error("Failed to load document list:", e), [];
  }
});
l.handle("docs:save-file-locally", async (e, r, t, n) => {
  try {
    const o = c.extname(t), a = c.join(_, `${r}${o}`);
    return i.writeFileSync(a, Buffer.from(n)), a;
  } catch (o) {
    throw console.error("Failed to save file locally:", o), o;
  }
});
l.handle("docs:read-local-file", async (e, r) => {
  try {
    if (!i.existsSync(r)) throw new Error("File not found");
    return i.readFileSync(r);
  } catch (t) {
    throw console.error("Failed to read local file:", t), t;
  }
});
l.handle("drm:decrypt-cdc", async (e, r, t) => {
  try {
    return await L(r, t);
  } catch (n) {
    throw console.error("Decryption failed:", n), new Error(`Decryption failed: ${n.message}`);
  }
});
l.handle("drm:decrypt-payload", async (e, r, t) => {
  try {
    return await $(r, t);
  } catch (n) {
    throw console.error("Payload decryption failed:", n), new Error(`Payload decryption failed: ${n.message}`);
  }
});
l.handle("secure:set-data", async (e, r, t, n) => {
  if (!S.isEncryptionAvailable())
    throw new Error("Safe storage is not available on this system");
  const o = S.encryptString(n), a = D();
  return a[r] || (a[r] = {}), a[r][t] = o.toString("base64"), O(a), !0;
});
l.handle("secure:get-data", async (e, r, t) => {
  if (!S.isEncryptionAvailable())
    throw new Error("Safe storage is not available on this system");
  const o = D()[r]?.[t];
  if (!o) return null;
  try {
    return S.decryptString(Buffer.from(o, "base64"));
  } catch (a) {
    return console.error(`Failed to decrypt ${t} for ${r}:`, a), null;
  }
});
l.handle("secure:remove-doc-data", async (e, r) => {
  const t = D();
  return t[r] ? (delete t[r], O(t), !0) : !1;
});
process.env.APP_ROOT = c.join(T, "..");
const B = process.env.VITE_DEV_SERVER_URL, Q = c.join(process.env.APP_ROOT, "dist-electron"), R = c.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = B ? c.join(process.env.APP_ROOT, "public") : R;
let s;
const M = c.join(process.env.VITE_PUBLIC, "app-icon.png");
function J(e) {
  const r = (e.control || e.meta) && ["Equal", "NumpadAdd", "Minus", "NumpadSubtract", "Digit0", "Numpad0"].includes(e.code), t = (e.control || e.meta) && e.code === "KeyP", n = (e.control || e.meta) && e.code === "KeyS", o = e.code === "PrintScreen";
  return r || t || n || o;
}
function A() {
  s = new j({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#ffffff",
    show: !1,
    // Don't show the window until it's ready to avoid white screen
    icon: M,
    webPreferences: {
      preload: c.join(T, "preload.js"),
      contextIsolation: !0,
      nodeIntegration: !1
    }
  }), s.setContentProtection(!0), s.webContents.setZoomFactor(1), s.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
  }), s.webContents.on("zoom-changed", (e) => {
    e.preventDefault(), s?.webContents.setZoomFactor(1);
  }), s.webContents.on("before-input-event", (e, r) => {
    r.type === "keyDown" && J(r) && e.preventDefault();
  }), s.webContents.on("context-menu", (e) => {
    e.preventDefault();
  }), s.once("ready-to-show", () => {
    s?.show();
  }), s.webContents.setWindowOpenHandler(({ url: e }) => (e.startsWith("https:") && W.openExternal(e), { action: "deny" })), B ? s.loadURL(B) : s.loadFile(c.join(R, "index.html"));
}
y.on("window-all-closed", () => {
  process.platform !== "darwin" && (y.quit(), s = null);
});
y.on("activate", () => {
  j.getAllWindows().length === 0 && A();
});
y.whenReady().then(() => {
  k.defaultSession.on("will-download", (e) => {
    e.preventDefault();
  }), A();
});
export {
  Q as MAIN_DIST,
  R as RENDERER_DIST,
  B as VITE_DEV_SERVER_URL
};
//# sourceMappingURL=main.js.map

import * as G from "electron";
import { app as g, safeStorage as U } from "electron";
import { fileURLToPath as Z } from "node:url";
import i from "node:path";
import a from "node:fs";
import j from "node:crypto";
import { execFile as X } from "node:child_process";
import { spawn as Q } from "child_process";
function Y(t, e) {
  try {
    const r = typeof t == "string" ? JSON.parse(t) : t;
    if (typeof r != "object" || r === null)
      throw new Error("Invalid wrappedKey structure");
    const n = r, o = typeof n.iv == "string" ? n.iv : n.wrappedIv, c = typeof n.tag == "string" ? n.tag : n.authTag, f = typeof n.wrapped == "string" ? n.wrapped : typeof n.ciphertext == "string" ? n.ciphertext : n.encryptedKey;
    if (typeof o != "string" || typeof c != "string" || typeof f != "string")
      throw new Error("Invalid wrappedKey fields");
    const s = Buffer.from(o, "base64"), d = Buffer.from(c, "base64"), p = Buffer.from(f, "base64"), u = j.createDecipheriv("aes-256-gcm", e, s);
    return u.setAuthTag(d), Buffer.concat([u.update(p), u.final()]);
  } catch (r) {
    const n = r instanceof Error ? r.message : "Unknown unwrap error";
    throw console.error("unwrapKeyWithPass failed:", n), r;
  }
}
function k(t, e, r, n) {
  try {
    const o = j.createDecipheriv("aes-256-gcm", e, r);
    return o.setAuthTag(n), Buffer.concat([o.update(t), o.final()]);
  } catch (o) {
    const c = o instanceof Error ? o.message : "Unknown decrypt error";
    throw console.error("aesGcmDecrypt failed:", c), o;
  }
}
async function V(t, e) {
  if (typeof t != "object" || t === null)
    throw new Error("Invalid container format");
  const r = t, n = r.meta;
  if (typeof n != "object" || n === null)
    throw new Error("Invalid container metadata");
  const o = n, c = r.payload;
  if (typeof c != "string")
    throw new Error("Invalid container payload");
  if (typeof o.iv != "string" || typeof o.tag != "string")
    throw new Error("Invalid container crypto metadata");
  const f = j.createHash("sha256").update(e).digest("hex"), s = typeof o.salt == "string" ? o.salt : String(o.salt ?? ""), d = Buffer.from(s, "base64"), p = Buffer.from(s, "base64url"), u = [
    { name: "Raw PassKey + String Salt", p: e, s },
    { name: "Raw PassKey + Base64 Salt", p: e, s: d },
    { name: "Raw PassKey + Base64url Salt", p: e, s: p },
    { name: "Hashed PassKey + String Salt", p: f, s },
    { name: "Hashed PassKey + Base64 Salt", p: f, s: d },
    { name: "Hashed PassKey + Base64url Salt", p: f, s: p }
  ];
  let m = null;
  for (const x of u)
    try {
      const v = j.pbkdf2Sync(x.p, x.s, 1e5, 32, "sha256"), b = Y(o.wrappedKey, v), F = Buffer.from(o.iv, "base64"), P = Buffer.from(o.tag, "base64"), S = Buffer.from(c, "base64"), q = k(S, b, F, P);
      return console.log(`Successfully decrypted using ${x.name}`), {
        decryptedPayload: q.toString("utf8"),
        contentKey: b.toString("base64")
      };
    } catch (v) {
      const b = v instanceof Error ? v.message : "Unknown variation error";
      console.error(`${x.name} failed:`, b), m = v;
    }
  const w = m instanceof Error ? m.message : "Unknown decryption error";
  throw new Error(`Decryption failed: All variations failed. Last error: ${w}`);
}
async function M(t, e) {
  if (typeof t != "object" || t === null)
    throw new Error("Invalid container format");
  const r = t, n = r.meta;
  if (typeof n != "object" || n === null)
    throw new Error("Invalid container metadata");
  const o = n, c = r.payload;
  if (typeof c != "string")
    throw new Error("Invalid container payload");
  if (typeof o.iv != "string" || typeof o.tag != "string")
    throw new Error("Invalid container crypto metadata");
  const f = Buffer.from(e, "base64"), s = Buffer.from(o.iv, "base64"), d = Buffer.from(o.tag, "base64"), p = Buffer.from(c, "base64");
  return k(p, f, s, d).toString("utf8");
}
const C = i.join(g.getPath("userData"), "temp_conversions");
let K = Promise.resolve(), E = null;
function ee() {
  if (E) return E;
  const t = process.platform, e = [], r = t === "win32" ? "soffice.exe" : "soffice", n = i.join("libreoffice", "program", r), o = process.env.APP_ROOT ? i.resolve(process.env.APP_ROOT) : process.cwd();
  if (e.push(i.join(g.getAppPath(), "resources", n)), e.push(i.join(i.dirname(g.getAppPath()), "resources", n)), e.push(i.join(o, "resources", n)), e.push(i.join(process.resourcesPath, n)), e.push(i.join(process.cwd(), "resources", n)), e.push(i.join(process.cwd(), "..", "resources", n)), t === "win32") {
    const c = process.env.PROGRAMFILES || "C:\\Program Files", f = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    e.push(
      i.join(c, "LibreOffice", "program", r),
      i.join(f, "LibreOffice", "program", r)
    );
  } else t === "darwin" ? e.push("/Applications/LibreOffice.app/Contents/MacOS/soffice") : e.push(
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/usr/local/bin/soffice",
    "/usr/bin/soffice.bin"
  );
  for (const c of e)
    if (a.existsSync(c))
      return E = c, console.log(`[LibreOffice] Detected soffice executable at: ${c}`), c;
  return E = r, console.log("[LibreOffice] soffice executable not found in standard paths; falling back to global PATH lookup."), E;
}
function te(t, e, r) {
  const n = (f) => {
    if (!f) return null;
    const s = i.extname(f).toLowerCase();
    return s === ".pdf" ? { ext: ".pdf", mime: "application/pdf" } : s === ".txt" ? { ext: ".txt", mime: "text/plain" } : s === ".csv" ? { ext: ".csv", mime: "text/csv" } : s === ".rtf" ? { ext: ".rtf", mime: "application/rtf" } : s === ".docx" ? { ext: ".docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } : s === ".doc" ? { ext: ".doc", mime: "application/msword" } : s === ".odt" ? { ext: ".odt", mime: "application/vnd.oasis.opendocument.text" } : s === ".xlsx" ? { ext: ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } : s === ".xls" ? { ext: ".xls", mime: "application/vnd.ms-excel" } : s === ".ods" ? { ext: ".ods", mime: "application/vnd.oasis.opendocument.spreadsheet" } : s === ".pptx" ? { ext: ".pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" } : s === ".ppt" ? { ext: ".ppt", mime: "application/vnd.ms-powerpoint" } : s === ".odp" ? { ext: ".odp", mime: "application/vnd.oasis.opendocument.presentation" } : s === ".png" ? { ext: ".png", mime: "image/png" } : s === ".jpg" || s === ".jpeg" ? { ext: s, mime: "image/jpeg" } : s === ".gif" ? { ext: ".gif", mime: "image/gif" } : s === ".bmp" ? { ext: ".bmp", mime: "image/bmp" } : s === ".webp" ? { ext: ".webp", mime: "image/webp" } : s === ".svg" ? { ext: ".svg", mime: "image/svg+xml" } : s === ".tif" || s === ".tiff" ? { ext: s, mime: "image/tiff" } : s === ".ico" ? { ext: ".ico", mime: "image/x-icon" } : s === ".avif" ? { ext: ".avif", mime: "image/avif" } : null;
  };
  if (t.length >= 4) {
    const f = t.toString("hex", 0, 4).toUpperCase();
    if (f === "25504446") return { ext: ".pdf", mime: "application/pdf" };
    if (f === "89504E47") return { ext: ".png", mime: "image/png" };
    if (f === "47494638") return { ext: ".gif", mime: "image/gif" };
    if (t[0] === 255 && t[1] === 216) return { ext: ".jpg", mime: "image/jpeg" };
    if (t.toString("hex", 0, 2).toUpperCase() === "424D") return { ext: ".bmp", mime: "image/bmp" };
    if (t.toString("hex", 0, 4).toUpperCase() === "00000100") return { ext: ".ico", mime: "image/x-icon" };
    if (t.toString("ascii", 0, 4) === "RIFF" && t.toString("ascii", 8, 12) === "WEBP")
      return { ext: ".webp", mime: "image/webp" };
    const s = t.toString("hex", 0, 4).toUpperCase();
    if (s === "49492A00" || s === "4D4D002A")
      return { ext: ".tiff", mime: "image/tiff" };
    if (t.toString("utf8", 0, 5) === "{\\rtf")
      return { ext: ".rtf", mime: "application/rtf" };
    if (f === "504B0304") {
      if (e) {
        if (e.includes("word") || e.includes("docx")) return { ext: ".docx", mime: e };
        if (e.includes("sheet") || e.includes("xlsx") || e.includes("excel")) return { ext: ".xlsx", mime: e };
        if (e.includes("presentation") || e.includes("pptx") || e.includes("powerpoint")) return { ext: ".pptx", mime: e };
        if (e.includes("vnd.oasis.opendocument.text")) return { ext: ".odt", mime: e };
        if (e.includes("vnd.oasis.opendocument.spreadsheet")) return { ext: ".ods", mime: e };
        if (e.includes("vnd.oasis.opendocument.presentation")) return { ext: ".odp", mime: e };
      }
      const p = n(r);
      if (p) return p;
      const u = t.toString("utf8");
      return u.includes("word/") ? { ext: ".docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } : u.includes("xl/") ? { ext: ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } : u.includes("ppt/") ? { ext: ".pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" } : u.includes("vnd.oasis.opendocument.text") ? { ext: ".odt", mime: "application/vnd.oasis.opendocument.text" } : u.includes("vnd.oasis.opendocument.spreadsheet") ? { ext: ".ods", mime: "application/vnd.oasis.opendocument.spreadsheet" } : u.includes("vnd.oasis.opendocument.presentation") ? { ext: ".odp", mime: "application/vnd.oasis.opendocument.presentation" } : { ext: ".docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    }
    if (t.toString("hex", 0, 8).toUpperCase() === "D0CF11E0A1B11AE1") {
      if (e) {
        if (e.includes("msword") || e.includes("word")) return { ext: ".doc", mime: e };
        if (e.includes("excel") || e.includes("sheet")) return { ext: ".xls", mime: e };
        if (e.includes("powerpoint") || e.includes("presentation")) return { ext: ".ppt", mime: e };
      }
      const p = n(r);
      return p && [".doc", ".xls", ".ppt"].includes(p.ext) ? p : { ext: ".doc", mime: "application/msword" };
    }
  }
  if (t.toString("utf8", 0, 256).trim().toLowerCase().startsWith("<svg"))
    return { ext: ".svg", mime: "image/svg+xml" };
  if (e) {
    if (e === "application/pdf") return { ext: ".pdf", mime: "application/pdf" };
    if (e === "text/plain") return { ext: ".txt", mime: "text/plain" };
    if (e.includes("csv")) return { ext: ".csv", mime: "text/csv" };
    if (e.includes("image/")) {
      if (e.includes("png")) return { ext: ".png", mime: e };
      if (e.includes("jpeg") || e.includes("jpg")) return { ext: ".jpg", mime: e };
      if (e.includes("gif")) return { ext: ".gif", mime: e };
      if (e.includes("bmp")) return { ext: ".bmp", mime: e };
      if (e.includes("webp")) return { ext: ".webp", mime: e };
      if (e.includes("svg")) return { ext: ".svg", mime: e };
      if (e.includes("tiff")) return { ext: ".tiff", mime: e };
      if (e.includes("icon")) return { ext: ".ico", mime: e };
      if (e.includes("avif")) return { ext: ".avif", mime: e };
    }
  }
  const c = n(r);
  return c || { ext: ".txt", mime: "text/plain" };
}
function re() {
  try {
    a.existsSync(C) && a.rmSync(C, { recursive: !0, force: !0 }), a.mkdirSync(C, { recursive: !0 });
  } catch (t) {
    console.error("[LibreOffice] Failed to initialise conversions temp directory:", t);
  }
}
function ne(t, e, r = 3e4) {
  return new Promise((n, o) => {
    const c = X(t, e, (s, d, p) => {
      if (f && clearTimeout(f), s)
        return console.error("[LibreOffice] soffice execution error:", s), console.error("[LibreOffice] stderr:", p), console.log("[LibreOffice] stdout:", d), o(new Error(`LibreOffice conversion failed: ${s.message}`));
      n();
    }), f = setTimeout(() => {
      console.warn(`[LibreOffice] Conversion timed out after ${r / 1e3}s. Killing soffice...`), c.kill("SIGKILL"), o(new Error("LibreOffice conversion timed out. Please try again."));
    }, r);
  });
}
function oe(t, e, r, n) {
  const o = K.then(async () => {
    const c = te(e, r, n);
    if (console.log(`[LibreOffice] Detected format for docId ${t}: ${c.ext} (${c.mime})`), c.ext === ".pdf")
      return e;
    const f = Math.random().toString(36).substring(2, 10), s = i.join(C, `${t}_${f}`), d = i.join(s, `input${c.ext}`), p = i.join(s, "input.pdf");
    try {
      a.mkdirSync(s, { recursive: !0 }), a.writeFileSync(d, e);
      const u = ee(), m = i.join(s, "profile"), w = [
        "--headless",
        `-env:UserInstallation=file:///${m.replace(/\\/g, "/")}`,
        "--convert-to",
        "pdf",
        d,
        "--outdir",
        s
      ];
      if (console.log(`[LibreOffice] Starting conversion for docId ${t} using userProfileDir: ${m}`), await ne(u, w), !a.existsSync(p))
        throw new Error("LibreOffice finished converting but no PDF output was found.");
      const x = a.readFileSync(p);
      return console.log(`[LibreOffice] Successfully converted docId ${t} to PDF, size: ${x.length} bytes.`), x;
    } finally {
      try {
        if (a.existsSync(d)) {
          const u = a.statSync(d).size, m = Buffer.alloc(u);
          a.writeFileSync(d, m);
        }
        if (a.existsSync(p)) {
          const u = a.statSync(p).size, m = Buffer.alloc(u);
          a.writeFileSync(p, m);
        }
      } catch (u) {
        console.warn("[LibreOffice] Failed to safely overwrite temporary files during shredding:", u);
      }
      try {
        a.existsSync(s) && (a.rmSync(s, { recursive: !0, force: !0 }), console.log(`[LibreOffice] Safely destroyed temporary session directory: ${s}`));
      } catch (u) {
        console.error(`[LibreOffice] Error deleting temporary session directory ${s}:`, u);
      }
    }
  });
  return K = o.catch((c) => {
    console.error("[LibreOffice] Conversion queue item failed:", c);
  }), o;
}
const se = i.join(g.getPath("temp"), "confi-share"), D = /* @__PURE__ */ new Set();
function ce() {
  const e = process.platform === "win32" ? "soffice.exe" : "soffice", r = i.join("libreoffice", "program", e), n = i.join(g.getAppPath(), "resources", r);
  if (a.existsSync(n)) return n;
  const o = i.join(process.resourcesPath, r);
  if (a.existsSync(o)) return o;
  const c = i.join(process.cwd(), "resources", r);
  if (a.existsSync(c)) return c;
  throw new Error(`Bundled LibreOffice binary not found. Expected at one of:
${o}
${n}
${c}
Please ensure the LibreOffice binaries are placed in the 'resources/libreoffice/program' directory of the project.`);
}
function $(t, e) {
  try {
    if (!U.isEncryptionAvailable())
      return null;
    const r = i.join(g.getPath("userData"), "secure_metadata.json");
    if (!a.existsSync(r)) return null;
    const o = JSON.parse(a.readFileSync(r, "utf-8"))[t]?.[e];
    return o ? U.decryptString(Buffer.from(o, "base64")) : null;
  } catch (r) {
    return console.error(`[documentProcessor] Failed to decrypt ${e} for ${t}:`, r), null;
  }
}
const ie = /* @__PURE__ */ new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "svg",
  "tif",
  "tiff",
  "ico",
  "avif"
]);
function _(t) {
  if (!t) return "unknown";
  const e = i.extname(t).toLowerCase();
  return e === ".pdf" ? "pdf" : e === ".docx" ? "docx" : e === ".doc" ? "doc" : e === ".xlsx" ? "xlsx" : e === ".xls" ? "xls" : e === ".pptx" ? "pptx" : e === ".ppt" ? "ppt" : e === ".rtf" ? "rtf" : e === ".txt" || e === ".csv" ? "txt" : e === ".odt" ? "odt" : e === ".ods" ? "ods" : e === ".odp" ? "odp" : e === ".png" ? "png" : e === ".jpg" ? "jpg" : e === ".jpeg" ? "jpeg" : e === ".gif" ? "gif" : e === ".bmp" ? "bmp" : e === ".webp" ? "webp" : e === ".svg" ? "svg" : e === ".tif" ? "tif" : e === ".tiff" ? "tiff" : e === ".ico" ? "ico" : e === ".avif" ? "avif" : "unknown";
}
function ae(t, e, r) {
  if (t.length >= 4) {
    const o = t.toString("hex", 0, 4).toUpperCase();
    if (o === "25504446") return "pdf";
    if (o === "89504E47") return "png";
    if (o === "47494638") return "gif";
    if (t.toString("hex", 0, 2).toUpperCase() === "424D") return "bmp";
    if (t[0] === 255 && t[1] === 216) return "jpg";
    if (t.toString("ascii", 0, 4) === "RIFF" && t.toString("ascii", 8, 12) === "WEBP")
      return "webp";
    const c = t.toString("hex", 0, 4).toUpperCase();
    if (c === "49492A00" || c === "4D4D002A") return "tiff";
    if (t.toString("hex", 0, 4).toUpperCase() === "00000100") return "ico";
    if (t.toString("utf8", 0, 5) === "{\\rtf") return "rtf";
    if (o === "504B0304") {
      if (e) {
        if (e.includes("word") || e.includes("docx")) return "docx";
        if (e.includes("sheet") || e.includes("xlsx") || e.includes("excel")) return "xlsx";
        if (e.includes("presentation") || e.includes("pptx") || e.includes("powerpoint")) return "pptx";
        if (e.includes("vnd.oasis.opendocument.text")) return "odt";
        if (e.includes("vnd.oasis.opendocument.spreadsheet")) return "ods";
        if (e.includes("vnd.oasis.opendocument.presentation")) return "odp";
      }
      const f = _(r);
      if (f !== "unknown") return f;
      const s = t.toString("utf8");
      return s.includes("word/") ? "docx" : s.includes("xl/") ? "xlsx" : s.includes("ppt/") ? "pptx" : s.includes("vnd.oasis.opendocument.text") ? "odt" : s.includes("vnd.oasis.opendocument.spreadsheet") ? "ods" : s.includes("vnd.oasis.opendocument.presentation") ? "odp" : "docx";
    }
    if (t.toString("hex", 0, 8).toUpperCase() === "D0CF11E0A1B11AE1") {
      if (e) {
        if (e.includes("msword") || e.includes("word")) return "doc";
        if (e.includes("excel") || e.includes("sheet")) return "xls";
        if (e.includes("powerpoint") || e.includes("presentation")) return "ppt";
      }
      const f = _(r);
      return f === "doc" || f === "xls" || f === "ppt" ? f : "doc";
    }
  }
  if (t.toString("utf8", 0, 512).trim().toLowerCase().startsWith("<svg")) return "svg";
  if (e) {
    if (e === "application/pdf") return "pdf";
    if (e.startsWith("image/")) {
      if (e.includes("png")) return "png";
      if (e.includes("jpeg") || e.includes("jpg")) return "jpeg";
      if (e.includes("gif")) return "gif";
      if (e.includes("bmp")) return "bmp";
      if (e.includes("webp")) return "webp";
      if (e.includes("svg")) return "svg";
      if (e.includes("tiff")) return "tiff";
      if (e.includes("icon")) return "ico";
      if (e.includes("avif")) return "avif";
    }
    if (e.includes("word") || e.includes("docx")) return "docx";
    if (e.includes("sheet") || e.includes("xlsx") || e.includes("excel")) return "xlsx";
    if (e.includes("presentation") || e.includes("pptx") || e.includes("powerpoint")) return "pptx";
    if (e.includes("rtf")) return "rtf";
    if (e.includes("text/plain") || e.includes("csv")) return "txt";
    if (e.includes("vnd.oasis.opendocument.text")) return "odt";
    if (e.includes("vnd.oasis.opendocument.spreadsheet")) return "ods";
    if (e.includes("vnd.oasis.opendocument.presentation")) return "odp";
  }
  return _(r);
}
function fe() {
  const t = j.randomUUID(), e = i.join(se, `session-${t}`);
  return a.mkdirSync(e, { recursive: !0 }), D.add(e), e;
}
function A(t) {
  try {
    if (a.existsSync(t)) {
      const e = a.readdirSync(t);
      for (const r of e) {
        const n = i.join(t, r);
        if (a.statSync(n).isFile())
          try {
            const o = a.statSync(n).size;
            a.writeFileSync(n, Buffer.alloc(o));
          } catch (o) {
            console.warn(`[documentProcessor] Could not zero file ${r}:`, o);
          }
      }
      a.rmSync(t, { recursive: !0, force: !0 }), console.log(`[documentProcessor] Safely destroyed temp session directory: ${t}`);
    }
  } catch (e) {
    console.error(`[documentProcessor] Error during session cleanup for ${t}:`, e);
  }
  D.delete(t);
}
function de() {
  console.log(`[documentProcessor] Performing final secure cleanup of ${D.size} active sessions...`);
  for (const t of D)
    A(t);
}
function ue(t, e) {
  return new Promise((r, n) => {
    const o = ce();
    if (console.log(`[documentProcessor] Starting LibreOffice conversion with path: ${o}`), !a.existsSync(o))
      return console.error(`[documentProcessor] Bundled LibreOffice binary not found at: ${o}`), n(new Error("Bundled LibreOffice binary not found. Please ensure it is placed in the resources folder."));
    const c = i.join(e, "profile"), f = Q(o, [
      "--headless",
      `-env:UserInstallation=file:///${c.replace(/\\/g, "/")}`,
      "--convert-to",
      "pdf",
      t,
      "--outdir",
      e
    ]);
    let s = "";
    f.stderr?.on("data", (d) => {
      s += d.toString();
    }), f.on("error", (d) => {
      console.error("[documentProcessor] LibreOffice process spawn error:", d), n(new Error(`LibreOffice conversion failed to spawn: ${d.message}`));
    }), f.on("close", (d) => {
      if (d !== 0)
        return console.error(`[documentProcessor] Soffice process exited with code ${d}. Stderr: ${s}`), n(new Error(`Conversion failed with exit code ${d}.`));
      const u = `${i.parse(t).name}.pdf`, m = i.join(e, u);
      if (!a.existsSync(m))
        return n(new Error("LibreOffice exited successfully, but no output PDF file was found."));
      console.log(`[documentProcessor] Office file converted successfully: ${m}`), r(m);
    });
  });
}
async function pe(t, e) {
  if (console.log(`[documentProcessor] Opening protected file: ${t}`), !a.existsSync(t))
    throw new Error(`File does not exist: ${t}`);
  const r = a.readFileSync(t, "utf8"), n = JSON.parse(r), o = i.parse(t).name;
  let c = e;
  if (!c) {
    const S = $(o, "realDocId") || o;
    c = $(S, "passKey") || $(o, "passKey") || void 0;
  }
  if (!c)
    throw new Error("Access code required to decrypt this document.");
  const f = await V(n, c), d = JSON.parse(f.decryptedPayload).file;
  if (!d)
    throw new Error("Invalid document payload structure.");
  const p = Buffer.from(d, "base64"), u = n.meta?.mime, m = n.meta?.name || i.basename(t), w = ae(p, u, m);
  console.log(`[documentProcessor] Detected type: ${w}`);
  const x = fe(), v = i.extname(m).replace(".", "").toLowerCase(), F = (w === "unknown" ? v || "bin" : w).replace(/[^a-z0-9]/g, "") || "bin", P = i.join(x, `source.${F}`);
  if (a.writeFileSync(P, p), w === "pdf" || ie.has(w))
    return { pdfPath: P, sessionDir: x };
  try {
    return { pdfPath: await ue(P, x), sessionDir: x };
  } catch (S) {
    throw A(x), S;
  }
}
const { app: h, BrowserWindow: N, ipcMain: y, safeStorage: B, session: le } = G, z = i.dirname(Z(import.meta.url)), L = i.join(h.getPath("userData"), "secure_metadata.json"), I = i.join(h.getPath("userData"), "documents.json"), T = i.join(h.getPath("userData"), "stored_docs");
a.existsSync(T) || a.mkdirSync(T, { recursive: !0 });
function R() {
  if (!a.existsSync(L)) return {};
  try {
    return JSON.parse(a.readFileSync(L, "utf-8"));
  } catch {
    return {};
  }
}
function W(t) {
  a.writeFileSync(L, JSON.stringify(t, null, 2));
}
y.handle("docs:save-list", async (t, e) => {
  try {
    return a.writeFileSync(I, JSON.stringify(e, null, 2)), !0;
  } catch (r) {
    return console.error("Failed to save document list:", r), !1;
  }
});
y.handle("docs:load-list", async () => {
  try {
    if (!a.existsSync(I)) return [];
    const t = a.readFileSync(I, "utf-8");
    return JSON.parse(t);
  } catch (t) {
    return console.error("Failed to load document list:", t), [];
  }
});
y.handle("docs:save-file-locally", async (t, e, r, n) => {
  try {
    const o = i.extname(r), c = i.join(T, `${e}${o}`);
    return a.writeFileSync(c, Buffer.from(n)), c;
  } catch (o) {
    throw console.error("Failed to save file locally:", o), o;
  }
});
y.handle("docs:read-local-file", async (t, e) => {
  try {
    if (!a.existsSync(e)) throw new Error("File not found");
    return a.readFileSync(e);
  } catch (r) {
    throw console.error("Failed to read local file:", r), r;
  }
});
y.handle("drm:decrypt-cdc", async (t, e, r) => {
  try {
    return await V(e, r);
  } catch (n) {
    throw console.error("Decryption failed:", n), new Error(`Decryption failed: ${n.message}`);
  }
});
y.handle("drm:decrypt-payload", async (t, e, r) => {
  try {
    return await M(e, r);
  } catch (n) {
    throw console.error("Payload decryption failed:", n), new Error(`Payload decryption failed: ${n.message}`);
  }
});
y.handle("drm:convert-office-to-pdf", async (t, e, r, n, o) => {
  try {
    const c = Buffer.from(r, "base64");
    return await oe(e, c, o, n);
  } catch (c) {
    throw console.error("Office document conversion IPC failed:", c), new Error(`Office document conversion IPC failed: ${c.message}`);
  }
});
y.handle("open-cdc-file", async (t, e, r) => {
  try {
    return await pe(e, r);
  } catch (n) {
    throw console.error("Secure CDC document viewer pipeline failed:", n), new Error(n.message || "Secure CDC document viewer pipeline failed.");
  }
});
y.handle("close-cdc-session", async (t, e) => {
  try {
    return A(e), !0;
  } catch (r) {
    return console.error("Failed to close secure session:", r), !1;
  }
});
y.handle("secure:set-data", async (t, e, r, n) => {
  if (!B.isEncryptionAvailable())
    throw new Error("Safe storage is not available on this system");
  const o = B.encryptString(n), c = R();
  return c[e] || (c[e] = {}), c[e][r] = o.toString("base64"), W(c), !0;
});
y.handle("secure:get-data", async (t, e, r) => {
  if (!B.isEncryptionAvailable())
    throw new Error("Safe storage is not available on this system");
  const o = R()[e]?.[r];
  if (!o) return null;
  try {
    return B.decryptString(Buffer.from(o, "base64"));
  } catch (c) {
    return console.error(`Failed to decrypt ${r} for ${e}:`, c), null;
  }
});
y.handle("secure:remove-doc-data", async (t, e) => {
  const r = R();
  return r[e] ? (delete r[e], W(r), !0) : !1;
});
process.env.APP_ROOT = i.join(z, "..");
const O = process.env.VITE_DEV_SERVER_URL, Pe = i.join(process.env.APP_ROOT, "dist-electron"), H = i.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = O ? i.join(process.env.APP_ROOT, "public") : H;
let l;
const me = i.join(process.env.VITE_PUBLIC, "app-icon.png");
function xe(t) {
  const e = (t.control || t.meta) && ["Equal", "NumpadAdd", "Minus", "NumpadSubtract", "Digit0", "Numpad0"].includes(t.code), r = (t.control || t.meta) && t.code === "KeyP", n = (t.control || t.meta) && t.code === "KeyS", o = (h.isPackaged || !O) && (t.code === "F12" || (t.control || t.meta) && t.shift && t.code === "KeyI" || (t.control || t.meta) && t.alt && t.code === "KeyI");
  return e || r || n || o;
}
function J() {
  l = new N({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#ffffff",
    show: !1,
    // Don't show the window until it's ready to avoid white screen
    icon: me,
    webPreferences: {
      preload: i.join(z, "preload.js"),
      contextIsolation: !0,
      nodeIntegration: !1,
      sandbox: !0
    }
  }), l.setContentProtection(!1), y.handle("window:set-content-protection", async (t, e) => {
    try {
      return l && l.setContentProtection(!!e), !0;
    } catch (r) {
      return console.error("Failed to set content protection:", r), !1;
    }
  }), l.webContents.setZoomFactor(1), l.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
  }), l.webContents.on("zoom-changed", (t) => {
    t.preventDefault(), l?.webContents.setZoomFactor(1);
  }), l.webContents.on("before-input-event", (t, e) => {
    e.type === "keyDown" && xe(e) && t.preventDefault();
  }), l.webContents.on("context-menu", (t) => {
    t.preventDefault();
  }), l.once("ready-to-show", () => {
    l?.show();
  }), l.webContents.setWindowOpenHandler(() => ({ action: "deny" })), l.webContents.on("will-navigate", (t) => {
    t.preventDefault();
  }), (h.isPackaged || !O) && l.webContents.on("devtools-opened", () => {
    l?.webContents.closeDevTools();
  }), O ? l.loadURL(O) : l.loadFile(i.join(H, "index.html"));
}
h.on("window-all-closed", () => {
  process.platform !== "darwin" && (h.quit(), l = null);
});
h.on("activate", () => {
  N.getAllWindows().length === 0 && J();
});
h.whenReady().then(() => {
  le.defaultSession.on("will-download", (t) => {
    t.preventDefault();
  }), re(), J();
});
h.on("will-quit", () => {
  try {
    de();
  } catch (t) {
    console.error("Failed to securely wipe active CDC sessions:", t);
  }
  try {
    const t = i.join(h.getPath("userData"), "temp_conversions");
    a.existsSync(t) && a.rmSync(t, { recursive: !0, force: !0 });
  } catch (t) {
    console.error("Failed to clean up temp conversions directory on quit:", t);
  }
});
export {
  Pe as MAIN_DIST,
  H as RENDERER_DIST,
  O as VITE_DEV_SERVER_URL
};
//# sourceMappingURL=main.js.map

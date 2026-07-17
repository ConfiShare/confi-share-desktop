import * as electron from "electron";
import { app as app$1, safeStorage as safeStorage$1 } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { spawn } from "child_process";
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
const CONVERSIONS_DIR = path.join(app$1.getPath("userData"), "temp_conversions");
let activeQueue = Promise.resolve();
let detectedSofficePath = null;
function getLibreOfficePath() {
  if (detectedSofficePath) return detectedSofficePath;
  const platform = process.platform;
  const possiblePaths = [];
  const execName = platform === "win32" ? "soffice.exe" : "soffice";
  const bundledSubPath = path.join("libreoffice", "program", execName);
  const appRoot = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : process.cwd();
  possiblePaths.push(path.join(app$1.getAppPath(), "resources", bundledSubPath));
  possiblePaths.push(path.join(path.dirname(app$1.getAppPath()), "resources", bundledSubPath));
  possiblePaths.push(path.join(appRoot, "resources", bundledSubPath));
  possiblePaths.push(path.join(process.resourcesPath, bundledSubPath));
  possiblePaths.push(path.join(process.cwd(), "resources", bundledSubPath));
  possiblePaths.push(path.join(process.cwd(), "..", "resources", bundledSubPath));
  if (platform === "win32") {
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    possiblePaths.push(
      path.join(programFiles, "LibreOffice", "program", execName),
      path.join(programFilesX86, "LibreOffice", "program", execName)
    );
  } else if (platform === "darwin") {
    possiblePaths.push("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  } else {
    possiblePaths.push(
      "/usr/bin/soffice",
      "/usr/bin/libreoffice",
      "/usr/local/bin/soffice",
      "/usr/bin/soffice.bin"
    );
  }
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      detectedSofficePath = p;
      console.log(`[LibreOffice] Detected soffice executable at: ${p}`);
      return p;
    }
  }
  detectedSofficePath = execName;
  console.log("[LibreOffice] soffice executable not found in standard paths; falling back to global PATH lookup.");
  return detectedSofficePath;
}
function detectFileType$1(buffer, originalMime, originalName) {
  const byExtension = (name) => {
    if (!name) return null;
    const ext = path.extname(name).toLowerCase();
    if (ext === ".pdf") return { ext: ".pdf", mime: "application/pdf" };
    if (ext === ".txt") return { ext: ".txt", mime: "text/plain" };
    if (ext === ".csv") return { ext: ".csv", mime: "text/csv" };
    if (ext === ".rtf") return { ext: ".rtf", mime: "application/rtf" };
    if (ext === ".docx") return { ext: ".docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    if (ext === ".doc") return { ext: ".doc", mime: "application/msword" };
    if (ext === ".odt") return { ext: ".odt", mime: "application/vnd.oasis.opendocument.text" };
    if (ext === ".xlsx") return { ext: ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    if (ext === ".xls") return { ext: ".xls", mime: "application/vnd.ms-excel" };
    if (ext === ".ods") return { ext: ".ods", mime: "application/vnd.oasis.opendocument.spreadsheet" };
    if (ext === ".pptx") return { ext: ".pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
    if (ext === ".ppt") return { ext: ".ppt", mime: "application/vnd.ms-powerpoint" };
    if (ext === ".odp") return { ext: ".odp", mime: "application/vnd.oasis.opendocument.presentation" };
    if (ext === ".png") return { ext: ".png", mime: "image/png" };
    if (ext === ".jpg" || ext === ".jpeg") return { ext, mime: "image/jpeg" };
    if (ext === ".gif") return { ext: ".gif", mime: "image/gif" };
    if (ext === ".bmp") return { ext: ".bmp", mime: "image/bmp" };
    if (ext === ".webp") return { ext: ".webp", mime: "image/webp" };
    if (ext === ".svg") return { ext: ".svg", mime: "image/svg+xml" };
    if (ext === ".tif" || ext === ".tiff") return { ext, mime: "image/tiff" };
    if (ext === ".ico") return { ext: ".ico", mime: "image/x-icon" };
    if (ext === ".avif") return { ext: ".avif", mime: "image/avif" };
    return null;
  };
  if (buffer.length >= 4) {
    const magic4 = buffer.toString("hex", 0, 4).toUpperCase();
    if (magic4 === "25504446") return { ext: ".pdf", mime: "application/pdf" };
    if (magic4 === "89504E47") return { ext: ".png", mime: "image/png" };
    if (magic4 === "47494638") return { ext: ".gif", mime: "image/gif" };
    if (buffer[0] === 255 && buffer[1] === 216) return { ext: ".jpg", mime: "image/jpeg" };
    if (buffer.toString("hex", 0, 2).toUpperCase() === "424D") return { ext: ".bmp", mime: "image/bmp" };
    if (buffer.toString("hex", 0, 4).toUpperCase() === "00000100") return { ext: ".ico", mime: "image/x-icon" };
    if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
      return { ext: ".webp", mime: "image/webp" };
    }
    const magicTiff = buffer.toString("hex", 0, 4).toUpperCase();
    if (magicTiff === "49492A00" || magicTiff === "4D4D002A") {
      return { ext: ".tiff", mime: "image/tiff" };
    }
    if (buffer.toString("utf8", 0, 5) === "{\\rtf") {
      return { ext: ".rtf", mime: "application/rtf" };
    }
    if (magic4 === "504B0304") {
      if (originalMime) {
        if (originalMime.includes("word") || originalMime.includes("docx")) return { ext: ".docx", mime: originalMime };
        if (originalMime.includes("sheet") || originalMime.includes("xlsx") || originalMime.includes("excel")) return { ext: ".xlsx", mime: originalMime };
        if (originalMime.includes("presentation") || originalMime.includes("pptx") || originalMime.includes("powerpoint")) return { ext: ".pptx", mime: originalMime };
        if (originalMime.includes("vnd.oasis.opendocument.text")) return { ext: ".odt", mime: originalMime };
        if (originalMime.includes("vnd.oasis.opendocument.spreadsheet")) return { ext: ".ods", mime: originalMime };
        if (originalMime.includes("vnd.oasis.opendocument.presentation")) return { ext: ".odp", mime: originalMime };
      }
      const extMatch2 = byExtension(originalName);
      if (extMatch2) return extMatch2;
      const zipString = buffer.toString("utf8");
      if (zipString.includes("word/")) return { ext: ".docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
      if (zipString.includes("xl/")) return { ext: ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
      if (zipString.includes("ppt/")) return { ext: ".pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
      if (zipString.includes("vnd.oasis.opendocument.text")) return { ext: ".odt", mime: "application/vnd.oasis.opendocument.text" };
      if (zipString.includes("vnd.oasis.opendocument.spreadsheet")) return { ext: ".ods", mime: "application/vnd.oasis.opendocument.spreadsheet" };
      if (zipString.includes("vnd.oasis.opendocument.presentation")) return { ext: ".odp", mime: "application/vnd.oasis.opendocument.presentation" };
      return { ext: ".docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    }
    const magic8 = buffer.toString("hex", 0, 8).toUpperCase();
    if (magic8 === "D0CF11E0A1B11AE1") {
      if (originalMime) {
        if (originalMime.includes("msword") || originalMime.includes("word")) return { ext: ".doc", mime: originalMime };
        if (originalMime.includes("excel") || originalMime.includes("sheet")) return { ext: ".xls", mime: originalMime };
        if (originalMime.includes("powerpoint") || originalMime.includes("presentation")) return { ext: ".ppt", mime: originalMime };
      }
      const extMatch2 = byExtension(originalName);
      if (extMatch2 && [".doc", ".xls", ".ppt"].includes(extMatch2.ext)) return extMatch2;
      return { ext: ".doc", mime: "application/msword" };
    }
  }
  const headerSnippet = buffer.toString("utf8", 0, 256).trim().toLowerCase();
  if (headerSnippet.startsWith("<svg")) {
    return { ext: ".svg", mime: "image/svg+xml" };
  }
  if (originalMime) {
    if (originalMime === "application/pdf") return { ext: ".pdf", mime: "application/pdf" };
    if (originalMime === "text/plain") return { ext: ".txt", mime: "text/plain" };
    if (originalMime.includes("csv")) return { ext: ".csv", mime: "text/csv" };
    if (originalMime.includes("image/")) {
      if (originalMime.includes("png")) return { ext: ".png", mime: originalMime };
      if (originalMime.includes("jpeg") || originalMime.includes("jpg")) return { ext: ".jpg", mime: originalMime };
      if (originalMime.includes("gif")) return { ext: ".gif", mime: originalMime };
      if (originalMime.includes("bmp")) return { ext: ".bmp", mime: originalMime };
      if (originalMime.includes("webp")) return { ext: ".webp", mime: originalMime };
      if (originalMime.includes("svg")) return { ext: ".svg", mime: originalMime };
      if (originalMime.includes("tiff")) return { ext: ".tiff", mime: originalMime };
      if (originalMime.includes("icon")) return { ext: ".ico", mime: originalMime };
      if (originalMime.includes("avif")) return { ext: ".avif", mime: originalMime };
    }
  }
  const extMatch = byExtension(originalName);
  if (extMatch) return extMatch;
  return { ext: ".txt", mime: "text/plain" };
}
function ensureConversionDirReady() {
  try {
    if (fs.existsSync(CONVERSIONS_DIR)) {
      fs.rmSync(CONVERSIONS_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(CONVERSIONS_DIR, { recursive: true });
  } catch (error) {
    console.error("[LibreOffice] Failed to initialise conversions temp directory:", error);
  }
}
function runSofficeConversion(sofficePath, args, timeoutMs = 3e4) {
  return new Promise((resolve, reject) => {
    const process2 = execFile(sofficePath, args, (error, stdout, stderr) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (error) {
        console.error("[LibreOffice] soffice execution error:", error);
        console.error("[LibreOffice] stderr:", stderr);
        console.log("[LibreOffice] stdout:", stdout);
        return reject(new Error(`LibreOffice conversion failed: ${error.message}`));
      }
      resolve();
    });
    const timeoutTimer = setTimeout(() => {
      console.warn(`[LibreOffice] Conversion timed out after ${timeoutMs / 1e3}s. Killing soffice...`);
      process2.kill("SIGKILL");
      reject(new Error("LibreOffice conversion timed out. Please try again."));
    }, timeoutMs);
  });
}
function convertToPdfSecurely(docId, buffer, originalMime, originalName) {
  const conversionTask = activeQueue.then(async () => {
    const fileType = detectFileType$1(buffer, originalMime, originalName);
    console.log(`[LibreOffice] Detected format for docId ${docId}: ${fileType.ext} (${fileType.mime})`);
    if (fileType.ext === ".pdf") {
      return buffer;
    }
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    const sessionDir = path.join(CONVERSIONS_DIR, `${docId}_${randomSuffix}`);
    const inputPath = path.join(sessionDir, `input${fileType.ext}`);
    const expectedPdfPath = path.join(sessionDir, "input.pdf");
    try {
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(inputPath, buffer);
      const sofficePath = getLibreOfficePath();
      const userProfileDir = path.join(sessionDir, "profile");
      const args = [
        "--headless",
        `-env:UserInstallation=file:///${userProfileDir.replace(/\\/g, "/")}`,
        "--convert-to",
        "pdf",
        inputPath,
        "--outdir",
        sessionDir
      ];
      console.log(`[LibreOffice] Starting conversion for docId ${docId} using userProfileDir: ${userProfileDir}`);
      await runSofficeConversion(sofficePath, args);
      if (!fs.existsSync(expectedPdfPath)) {
        throw new Error("LibreOffice finished converting but no PDF output was found.");
      }
      const pdfBuffer = fs.readFileSync(expectedPdfPath);
      console.log(`[LibreOffice] Successfully converted docId ${docId} to PDF, size: ${pdfBuffer.length} bytes.`);
      return pdfBuffer;
    } finally {
      try {
        if (fs.existsSync(inputPath)) {
          const size = fs.statSync(inputPath).size;
          const zeros = Buffer.alloc(size);
          fs.writeFileSync(inputPath, zeros);
        }
        if (fs.existsSync(expectedPdfPath)) {
          const size = fs.statSync(expectedPdfPath).size;
          const zeros = Buffer.alloc(size);
          fs.writeFileSync(expectedPdfPath, zeros);
        }
      } catch (cleanupErr) {
        console.warn("[LibreOffice] Failed to safely overwrite temporary files during shredding:", cleanupErr);
      }
      try {
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          console.log(`[LibreOffice] Safely destroyed temporary session directory: ${sessionDir}`);
        }
      } catch (rmErr) {
        console.error(`[LibreOffice] Error deleting temporary session directory ${sessionDir}:`, rmErr);
      }
    }
  });
  activeQueue = conversionTask.catch((err) => {
    console.error("[LibreOffice] Conversion queue item failed:", err);
  });
  return conversionTask;
}
const TEMP_DIR = path.join(app$1.getPath("temp"), "confi-share");
const activeSessions = /* @__PURE__ */ new Set();
function getSofficePath() {
  const platform = process.platform;
  const execName = platform === "win32" ? "soffice.exe" : "soffice";
  const subPath = path.join("libreoffice", "program", execName);
  const devPath = path.join(app$1.getAppPath(), "resources", subPath);
  if (fs.existsSync(devPath)) return devPath;
  const prodPath = path.join(process.resourcesPath, subPath);
  if (fs.existsSync(prodPath)) return prodPath;
  const cwdPath = path.join(process.cwd(), "resources", subPath);
  if (fs.existsSync(cwdPath)) return cwdPath;
  throw new Error(`Bundled LibreOffice binary not found. Expected at one of:
${prodPath}
${devPath}
${cwdPath}
Please ensure the LibreOffice binaries are placed in the 'resources/libreoffice/program' directory of the project.`);
}
function getSecureDataMain(docId, key) {
  try {
    if (!safeStorage$1.isEncryptionAvailable()) {
      return null;
    }
    const SECURE_DATA_PATH2 = path.join(app$1.getPath("userData"), "secure_metadata.json");
    if (!fs.existsSync(SECURE_DATA_PATH2)) return null;
    const metadata = JSON.parse(fs.readFileSync(SECURE_DATA_PATH2, "utf-8"));
    const encryptedBase64 = metadata[docId]?.[key];
    if (!encryptedBase64) return null;
    return safeStorage$1.decryptString(Buffer.from(encryptedBase64, "base64"));
  } catch (error) {
    console.error(`[documentProcessor] Failed to decrypt ${key} for ${docId}:`, error);
    return null;
  }
}
const CDC_IMAGE_TYPES = /* @__PURE__ */ new Set([
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
function detectByExtension(originalName) {
  if (!originalName) return "unknown";
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".doc") return "doc";
  if (ext === ".xlsx") return "xlsx";
  if (ext === ".xls") return "xls";
  if (ext === ".pptx") return "pptx";
  if (ext === ".ppt") return "ppt";
  if (ext === ".rtf") return "rtf";
  if (ext === ".txt" || ext === ".csv") return "txt";
  if (ext === ".odt") return "odt";
  if (ext === ".ods") return "ods";
  if (ext === ".odp") return "odp";
  if (ext === ".png") return "png";
  if (ext === ".jpg") return "jpg";
  if (ext === ".jpeg") return "jpeg";
  if (ext === ".gif") return "gif";
  if (ext === ".bmp") return "bmp";
  if (ext === ".webp") return "webp";
  if (ext === ".svg") return "svg";
  if (ext === ".tif") return "tif";
  if (ext === ".tiff") return "tiff";
  if (ext === ".ico") return "ico";
  if (ext === ".avif") return "avif";
  return "unknown";
}
function detectFileType(buffer, originalMime, originalName) {
  if (buffer.length >= 4) {
    const magic4 = buffer.toString("hex", 0, 4).toUpperCase();
    if (magic4 === "25504446") return "pdf";
    if (magic4 === "89504E47") return "png";
    if (magic4 === "47494638") return "gif";
    if (buffer.toString("hex", 0, 2).toUpperCase() === "424D") return "bmp";
    if (buffer[0] === 255 && buffer[1] === 216) return "jpg";
    if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
      return "webp";
    }
    const magicTiff = buffer.toString("hex", 0, 4).toUpperCase();
    if (magicTiff === "49492A00" || magicTiff === "4D4D002A") return "tiff";
    if (buffer.toString("hex", 0, 4).toUpperCase() === "00000100") return "ico";
    if (buffer.toString("utf8", 0, 5) === "{\\rtf") return "rtf";
    if (magic4 === "504B0304") {
      if (originalMime) {
        if (originalMime.includes("word") || originalMime.includes("docx")) return "docx";
        if (originalMime.includes("sheet") || originalMime.includes("xlsx") || originalMime.includes("excel")) return "xlsx";
        if (originalMime.includes("presentation") || originalMime.includes("pptx") || originalMime.includes("powerpoint")) return "pptx";
        if (originalMime.includes("vnd.oasis.opendocument.text")) return "odt";
        if (originalMime.includes("vnd.oasis.opendocument.spreadsheet")) return "ods";
        if (originalMime.includes("vnd.oasis.opendocument.presentation")) return "odp";
      }
      const extBased = detectByExtension(originalName);
      if (extBased !== "unknown") return extBased;
      const zipString = buffer.toString("utf8");
      if (zipString.includes("word/")) return "docx";
      if (zipString.includes("xl/")) return "xlsx";
      if (zipString.includes("ppt/")) return "pptx";
      if (zipString.includes("vnd.oasis.opendocument.text")) return "odt";
      if (zipString.includes("vnd.oasis.opendocument.spreadsheet")) return "ods";
      if (zipString.includes("vnd.oasis.opendocument.presentation")) return "odp";
      return "docx";
    }
    if (buffer.toString("hex", 0, 8).toUpperCase() === "D0CF11E0A1B11AE1") {
      if (originalMime) {
        if (originalMime.includes("msword") || originalMime.includes("word")) return "doc";
        if (originalMime.includes("excel") || originalMime.includes("sheet")) return "xls";
        if (originalMime.includes("powerpoint") || originalMime.includes("presentation")) return "ppt";
      }
      const extBased = detectByExtension(originalName);
      if (extBased === "doc" || extBased === "xls" || extBased === "ppt") {
        return extBased;
      }
      return "doc";
    }
  }
  const sniff = buffer.toString("utf8", 0, 512).trim().toLowerCase();
  if (sniff.startsWith("<svg")) return "svg";
  if (originalMime) {
    if (originalMime === "application/pdf") return "pdf";
    if (originalMime.startsWith("image/")) {
      if (originalMime.includes("png")) return "png";
      if (originalMime.includes("jpeg") || originalMime.includes("jpg")) return "jpeg";
      if (originalMime.includes("gif")) return "gif";
      if (originalMime.includes("bmp")) return "bmp";
      if (originalMime.includes("webp")) return "webp";
      if (originalMime.includes("svg")) return "svg";
      if (originalMime.includes("tiff")) return "tiff";
      if (originalMime.includes("icon")) return "ico";
      if (originalMime.includes("avif")) return "avif";
    }
    if (originalMime.includes("word") || originalMime.includes("docx")) return "docx";
    if (originalMime.includes("sheet") || originalMime.includes("xlsx") || originalMime.includes("excel")) return "xlsx";
    if (originalMime.includes("presentation") || originalMime.includes("pptx") || originalMime.includes("powerpoint")) return "pptx";
    if (originalMime.includes("rtf")) return "rtf";
    if (originalMime.includes("text/plain") || originalMime.includes("csv")) return "txt";
    if (originalMime.includes("vnd.oasis.opendocument.text")) return "odt";
    if (originalMime.includes("vnd.oasis.opendocument.spreadsheet")) return "ods";
    if (originalMime.includes("vnd.oasis.opendocument.presentation")) return "odp";
  }
  return detectByExtension(originalName);
}
function createTempSession() {
  const sessionUuid = crypto.randomUUID();
  const sessionDir = path.join(TEMP_DIR, `session-${sessionUuid}`);
  fs.mkdirSync(sessionDir, { recursive: true });
  activeSessions.add(sessionDir);
  return sessionDir;
}
function cleanupSession(sessionDir) {
  try {
    if (fs.existsSync(sessionDir)) {
      const files = fs.readdirSync(sessionDir);
      for (const file of files) {
        const filePath = path.join(sessionDir, file);
        if (fs.statSync(filePath).isFile()) {
          try {
            const size = fs.statSync(filePath).size;
            fs.writeFileSync(filePath, Buffer.alloc(size));
          } catch (writeErr) {
            console.warn(`[documentProcessor] Could not zero file ${file}:`, writeErr);
          }
        }
      }
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log(`[documentProcessor] Safely destroyed temp session directory: ${sessionDir}`);
    }
  } catch (error) {
    console.error(`[documentProcessor] Error during session cleanup for ${sessionDir}:`, error);
  }
  activeSessions.delete(sessionDir);
}
function cleanupAllSessions() {
  console.log(`[documentProcessor] Performing final secure cleanup of ${activeSessions.size} active sessions...`);
  for (const sessionDir of activeSessions) {
    cleanupSession(sessionDir);
  }
}
function convertToPDF(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    const sofficePath = getSofficePath();
    console.log(`[documentProcessor] Starting LibreOffice conversion with path: ${sofficePath}`);
    if (!fs.existsSync(sofficePath)) {
      console.error(`[documentProcessor] Bundled LibreOffice binary not found at: ${sofficePath}`);
      return reject(new Error("Bundled LibreOffice binary not found. Please ensure it is placed in the resources folder."));
    }
    const userProfileDir = path.join(outputDir, "profile");
    const proc = spawn(sofficePath, [
      "--headless",
      `-env:UserInstallation=file:///${userProfileDir.replace(/\\/g, "/")}`,
      "--convert-to",
      "pdf",
      inputPath,
      "--outdir",
      outputDir
    ]);
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      console.error("[documentProcessor] LibreOffice process spawn error:", err);
      reject(new Error(`LibreOffice conversion failed to spawn: ${err.message}`));
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        console.error(`[documentProcessor] Soffice process exited with code ${code}. Stderr: ${stderr}`);
        return reject(new Error(`Conversion failed with exit code ${code}.`));
      }
      const parsedInput = path.parse(inputPath);
      const expectedPdfName = `${parsedInput.name}.pdf`;
      const finalPdfPath = path.join(outputDir, expectedPdfName);
      if (!fs.existsSync(finalPdfPath)) {
        return reject(new Error("LibreOffice exited successfully, but no output PDF file was found."));
      }
      console.log(`[documentProcessor] Office file converted successfully: ${finalPdfPath}`);
      resolve(finalPdfPath);
    });
  });
}
async function openCDCFile(filePath, passKey) {
  console.log(`[documentProcessor] Opening protected file: ${filePath}`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  const containerContent = fs.readFileSync(filePath, "utf8");
  const container = JSON.parse(containerContent);
  const docId = path.parse(filePath).name;
  let key = passKey;
  if (!key) {
    const realDocId = getSecureDataMain(docId, "realDocId") || docId;
    key = getSecureDataMain(realDocId, "passKey") || getSecureDataMain(docId, "passKey") || void 0;
  }
  if (!key) {
    throw new Error("Access code required to decrypt this document.");
  }
  const decrypted = await decryptCDCContainer(container, key);
  const decryptedData = JSON.parse(decrypted.decryptedPayload);
  const fileBase64 = decryptedData.file;
  if (!fileBase64) {
    throw new Error("Invalid document payload structure.");
  }
  const fileBuffer = Buffer.from(fileBase64, "base64");
  const originalMime = container.meta?.mime;
  const originalName = container.meta?.name || path.basename(filePath);
  const type = detectFileType(fileBuffer, originalMime, originalName);
  console.log(`[documentProcessor] Detected type: ${type}`);
  const sessionDir = createTempSession();
  const fallbackExt = path.extname(originalName).replace(".", "").toLowerCase();
  const chosenExt = type === "unknown" ? fallbackExt || "bin" : type;
  const safeExt = chosenExt.replace(/[^a-z0-9]/g, "") || "bin";
  const sourcePath = path.join(sessionDir, `source.${safeExt}`);
  fs.writeFileSync(sourcePath, fileBuffer);
  if (type === "pdf" || CDC_IMAGE_TYPES.has(type)) {
    return { pdfPath: sourcePath, sessionDir };
  }
  try {
    const pdfPath = await convertToPDF(sourcePath, sessionDir);
    return { pdfPath, sessionDir };
  } catch (convError) {
    cleanupSession(sessionDir);
    throw convError;
  }
}
const { app, BrowserWindow, ipcMain, safeStorage, session } = electron;
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
ipcMain.handle("drm:convert-office-to-pdf", async (_event, docId, base64Data, originalName, originalMime) => {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    const pdfBuffer = await convertToPdfSecurely(docId, buffer, originalMime, originalName);
    return pdfBuffer;
  } catch (error) {
    console.error("Office document conversion IPC failed:", error);
    throw new Error(`Office document conversion IPC failed: ${error.message}`);
  }
});
ipcMain.handle("open-cdc-file", async (_event, filePath, passKey) => {
  try {
    return await openCDCFile(filePath, passKey);
  } catch (error) {
    console.error("Secure CDC document viewer pipeline failed:", error);
    throw new Error(error.message || "Secure CDC document viewer pipeline failed.");
  }
});
ipcMain.handle("close-cdc-session", async (_event, sessionDir) => {
  try {
    cleanupSession(sessionDir);
    return true;
  } catch (error) {
    console.error("Failed to close secure session:", error);
    return false;
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
  const isDevTools = (app.isPackaged || !VITE_DEV_SERVER_URL) && (input.code === "F12" || (input.control || input.meta) && input.shift && input.code === "KeyI" || (input.control || input.meta) && input.alt && input.code === "KeyI");
  return isZoomShortcut || isPrintShortcut || isSaveOrDownloadShortcut || isDevTools;
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
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setContentProtection(false);
  ipcMain.handle("window:set-content-protection", async (_event, enable) => {
    try {
      if (win) {
        win.setContentProtection(Boolean(enable));
      }
      return true;
    } catch (err) {
      console.error("Failed to set content protection:", err);
      return false;
    }
  });
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
  win.webContents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  if (app.isPackaged || !VITE_DEV_SERVER_URL) {
    win.webContents.on("devtools-opened", () => {
      win?.webContents.closeDevTools();
    });
  }
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
  ensureConversionDirReady();
  createWindow();
});
app.on("will-quit", () => {
  try {
    cleanupAllSessions();
  } catch (err) {
    console.error("Failed to securely wipe active CDC sessions:", err);
  }
  try {
    const tempDir = path.join(app.getPath("userData"), "temp_conversions");
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error("Failed to clean up temp conversions directory on quit:", err);
  }
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
//# sourceMappingURL=main.js.map

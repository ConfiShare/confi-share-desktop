import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'child_process';
import { decryptCDCContainer } from './crypto.js';

const TEMP_DIR = path.join(app.getPath('temp'), 'confi-share');
const activeSessions = new Set<string>();

/**
 * Resolves the strictly bundled soffice executable path.
 * No system path lookup, fallbacks or external redirects are used.
 */
export function getSofficePath(): string {
  const platform = process.platform;
  const execName = platform === 'win32' ? 'soffice.exe' : 'soffice';
  const subPath = path.join('libreoffice', 'program', execName);

  // Development: resources folder at project root
  const devPath = path.join(app.getAppPath(), 'resources', subPath);
  if (fs.existsSync(devPath)) return devPath;

  // Production (packed) binary in resourcesPath
  const prodPath = path.join(process.resourcesPath, subPath);
  if (fs.existsSync(prodPath)) return prodPath;

  // Fallback: try relative to current working directory (useful for IDE runs)
  const cwdPath = path.join(process.cwd(), 'resources', subPath);
  if (fs.existsSync(cwdPath)) return cwdPath;

  // If still not found, throw a clear error referencing all tried locations
  throw new Error(`Bundled LibreOffice binary not found. Expected at one of:\n${prodPath}\n${devPath}\n${cwdPath}\nPlease ensure the LibreOffice binaries are placed in the 'resources/libreoffice/program' directory of the project.`);
}

/**
 * Securely retrieves stored keys from Electron's safeStorage.
 */
function getSecureDataMain(docId: string, key: string): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }
    const SECURE_DATA_PATH = path.join(app.getPath('userData'), 'secure_metadata.json');
    if (!fs.existsSync(SECURE_DATA_PATH)) return null;

    const metadata = JSON.parse(fs.readFileSync(SECURE_DATA_PATH, 'utf-8'));
    const encryptedBase64 = metadata[docId]?.[key];
    if (!encryptedBase64) return null;

    return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'));
  } catch (error) {
    console.error(`[documentProcessor] Failed to decrypt ${key} for ${docId}:`, error);
    return null;
  }
}

type DetectedCdcFileType =
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'xlsx'
  | 'xls'
  | 'pptx'
  | 'ppt'
  | 'rtf'
  | 'txt'
  | 'odt'
  | 'ods'
  | 'odp'
  | 'png'
  | 'jpg'
  | 'jpeg'
  | 'gif'
  | 'bmp'
  | 'webp'
  | 'svg'
  | 'tif'
  | 'tiff'
  | 'ico'
  | 'avif'
  | 'unknown';

const CDC_IMAGE_TYPES = new Set<DetectedCdcFileType>([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'svg',
  'tif',
  'tiff',
  'ico',
  'avif',
]);

function detectByExtension(originalName?: string): DetectedCdcFileType {
  if (!originalName) return 'unknown';
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.doc') return 'doc';
  if (ext === '.xlsx') return 'xlsx';
  if (ext === '.xls') return 'xls';
  if (ext === '.pptx') return 'pptx';
  if (ext === '.ppt') return 'ppt';
  if (ext === '.rtf') return 'rtf';
  if (ext === '.txt' || ext === '.csv') return 'txt';
  if (ext === '.odt') return 'odt';
  if (ext === '.ods') return 'ods';
  if (ext === '.odp') return 'odp';
  if (ext === '.png') return 'png';
  if (ext === '.jpg') return 'jpg';
  if (ext === '.jpeg') return 'jpeg';
  if (ext === '.gif') return 'gif';
  if (ext === '.bmp') return 'bmp';
  if (ext === '.webp') return 'webp';
  if (ext === '.svg') return 'svg';
  if (ext === '.tif') return 'tif';
  if (ext === '.tiff') return 'tiff';
  if (ext === '.ico') return 'ico';
  if (ext === '.avif') return 'avif';

  return 'unknown';
}

/**
 * Detects the file type using magic bytes and metadata signatures inside ZIP/Compound structures.
 */
export function detectFileType(
  buffer: Buffer,
  originalMime?: string,
  originalName?: string
): DetectedCdcFileType {
  if (buffer.length >= 4) {
    const magic4 = buffer.toString('hex', 0, 4).toUpperCase();

    // PDF: %PDF
    if (magic4 === '25504446') return 'pdf';

    // PNG
    if (magic4 === '89504E47') return 'png';

    // GIF
    if (magic4 === '47494638') return 'gif';

    // BMP
    if (buffer.toString('hex', 0, 2).toUpperCase() === '424D') return 'bmp';

    // JPEG (FFD8...)
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';

    // WEBP (RIFF....WEBP)
    if (
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return 'webp';
    }

    // TIFF
    const magicTiff = buffer.toString('hex', 0, 4).toUpperCase();
    if (magicTiff === '49492A00' || magicTiff === '4D4D002A') return 'tiff';

    // ICO
    if (buffer.toString('hex', 0, 4).toUpperCase() === '00000100') return 'ico';

    // RTF
    if (buffer.toString('utf8', 0, 5) === '{\\rtf') return 'rtf';

    // ZIP / Office Open XML / OpenDocument
    if (magic4 === '504B0304') {
      if (originalMime) {
        if (originalMime.includes('word') || originalMime.includes('docx')) return 'docx';
        if (originalMime.includes('sheet') || originalMime.includes('xlsx') || originalMime.includes('excel')) return 'xlsx';
        if (originalMime.includes('presentation') || originalMime.includes('pptx') || originalMime.includes('powerpoint')) return 'pptx';
        if (originalMime.includes('vnd.oasis.opendocument.text')) return 'odt';
        if (originalMime.includes('vnd.oasis.opendocument.spreadsheet')) return 'ods';
        if (originalMime.includes('vnd.oasis.opendocument.presentation')) return 'odp';
      }

      const extBased = detectByExtension(originalName);
      if (extBased !== 'unknown') return extBased;

      const zipString = buffer.toString('utf8');
      if (zipString.includes('word/')) return 'docx';
      if (zipString.includes('xl/')) return 'xlsx';
      if (zipString.includes('ppt/')) return 'pptx';
      if (zipString.includes('vnd.oasis.opendocument.text')) return 'odt';
      if (zipString.includes('vnd.oasis.opendocument.spreadsheet')) return 'ods';
      if (zipString.includes('vnd.oasis.opendocument.presentation')) return 'odp';
      return 'docx';
    }

    // Compound binary (DOC/XLS/PPT)
    if (buffer.toString('hex', 0, 8).toUpperCase() === 'D0CF11E0A1B11AE1') {
      if (originalMime) {
        if (originalMime.includes('msword') || originalMime.includes('word')) return 'doc';
        if (originalMime.includes('excel') || originalMime.includes('sheet')) return 'xls';
        if (originalMime.includes('powerpoint') || originalMime.includes('presentation')) return 'ppt';
      }

      const extBased = detectByExtension(originalName);
      if (extBased === 'doc' || extBased === 'xls' || extBased === 'ppt') {
        return extBased;
      }
      return 'doc';
    }
  }

  const sniff = buffer.toString('utf8', 0, 512).trim().toLowerCase();
  if (sniff.startsWith('<svg')) return 'svg';

  if (originalMime) {
    if (originalMime === 'application/pdf') return 'pdf';
    if (originalMime.startsWith('image/')) {
      if (originalMime.includes('png')) return 'png';
      if (originalMime.includes('jpeg') || originalMime.includes('jpg')) return 'jpeg';
      if (originalMime.includes('gif')) return 'gif';
      if (originalMime.includes('bmp')) return 'bmp';
      if (originalMime.includes('webp')) return 'webp';
      if (originalMime.includes('svg')) return 'svg';
      if (originalMime.includes('tiff')) return 'tiff';
      if (originalMime.includes('icon')) return 'ico';
      if (originalMime.includes('avif')) return 'avif';
    }
    if (originalMime.includes('word') || originalMime.includes('docx')) return 'docx';
    if (originalMime.includes('sheet') || originalMime.includes('xlsx') || originalMime.includes('excel')) return 'xlsx';
    if (originalMime.includes('presentation') || originalMime.includes('pptx') || originalMime.includes('powerpoint')) return 'pptx';
    if (originalMime.includes('rtf')) return 'rtf';
    if (originalMime.includes('text/plain') || originalMime.includes('csv')) return 'txt';
    if (originalMime.includes('vnd.oasis.opendocument.text')) return 'odt';
    if (originalMime.includes('vnd.oasis.opendocument.spreadsheet')) return 'ods';
    if (originalMime.includes('vnd.oasis.opendocument.presentation')) return 'odp';
  }

  return detectByExtension(originalName);
}

/**
 * Creates a unique temp directory workspace using a random UUID.
 */
export function createTempSession(): string {
  const sessionUuid = crypto.randomUUID();
  const sessionDir = path.join(TEMP_DIR, `session-${sessionUuid}`);
  fs.mkdirSync(sessionDir, { recursive: true });
  activeSessions.add(sessionDir);
  return sessionDir;
}

/**
 * Shreds and safely destroys a single temp session directory.
 */
export function cleanupSession(sessionDir: string): void {
  try {
    if (fs.existsSync(sessionDir)) {
      // Overwrite all files inside with zero-bytes to prevent data recovery
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

/**
 * Destroys all active session directories. Called on app shutdown.
 */
export function cleanupAllSessions(): void {
  console.log(`[documentProcessor] Performing final secure cleanup of ${activeSessions.size} active sessions...`);
  for (const sessionDir of activeSessions) {
    cleanupSession(sessionDir);
  }
}

/**
 * Headlessly converts an Office input file to PDF using the strictly bundled LibreOffice executable.
 */
export function convertToPDF(inputPath: string, outputDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sofficePath = getSofficePath();
    console.log(`[documentProcessor] Starting LibreOffice conversion with path: ${sofficePath}`);

    if (!fs.existsSync(sofficePath)) {
      console.error(`[documentProcessor] Bundled LibreOffice binary not found at: ${sofficePath}`);
      return reject(new Error('Bundled LibreOffice binary not found. Please ensure it is placed in the resources folder.'));
    }

    // Set a unique user profile for this conversion to avoid profile locks
    const userProfileDir = path.join(outputDir, 'profile');

    const proc = spawn(sofficePath, [
      '--headless',
      `-env:UserInstallation=file:///${userProfileDir.replace(/\\/g, '/')}`,
      '--convert-to',
      'pdf',
      inputPath,
      '--outdir',
      outputDir,
    ]);

    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      console.error('[documentProcessor] LibreOffice process spawn error:', err);
      reject(new Error(`LibreOffice conversion failed to spawn: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`[documentProcessor] Soffice process exited with code ${code}. Stderr: ${stderr}`);
        return reject(new Error(`Conversion failed with exit code ${code}.`));
      }

      // Identify converted PDF path
      const parsedInput = path.parse(inputPath);
      const expectedPdfName = `${parsedInput.name}.pdf`;
      const finalPdfPath = path.join(outputDir, expectedPdfName);

      if (!fs.existsSync(finalPdfPath)) {
        return reject(new Error('LibreOffice exited successfully, but no output PDF file was found.'));
      }

      console.log(`[documentProcessor] Office file converted successfully: ${finalPdfPath}`);
      resolve(finalPdfPath);
    });
  });
}

/**
 * Decrypts a .cdc file, writes the raw content, converts Office formats, and returns both the final PDF path and session dir.
 */
export async function openCDCFile(filePath: string, passKey?: string): Promise<{ pdfPath: string; sessionDir: string }> {
  console.log(`[documentProcessor] Opening protected file: ${filePath}`);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  // 1. Read and parse the .cdc JSON container
  const containerContent = fs.readFileSync(filePath, 'utf8');
  const container = JSON.parse(containerContent);

  // 2. Resolve passKey/contentKey
  const docId = path.parse(filePath).name;
  let key = passKey;

  if (!key) {
    const realDocId = getSecureDataMain(docId, 'realDocId') || docId;
    key = getSecureDataMain(realDocId, 'passKey') || getSecureDataMain(docId, 'passKey') || undefined;
  }

  if (!key) {
    throw new Error('Access code required to decrypt this document.');
  }

  // 3. Fully decrypt the container using the resolved key
  const decrypted = await decryptCDCContainer(container, key);
  const decryptedData = JSON.parse(decrypted.decryptedPayload);

  const fileBase64 = decryptedData.file;
  if (!fileBase64) {
    throw new Error('Invalid document payload structure.');
  }
  const fileBuffer = Buffer.from(fileBase64, 'base64');

  // 4. Detect actual file type from bytes and container metadata
  const originalMime = container.meta?.mime;
  const originalName = container.meta?.name || path.basename(filePath);
  const type = detectFileType(fileBuffer, originalMime, originalName);
  console.log(`[documentProcessor] Detected type: ${type}`);

  // 5. Establish secure temp session directory
  const sessionDir = createTempSession();
  
  // Save source file inside session dir with detected/derived extension for parser compatibility
  const fallbackExt = path.extname(originalName).replace('.', '').toLowerCase();
  const chosenExt = type === 'unknown' ? (fallbackExt || 'bin') : type;
  const safeExt = chosenExt.replace(/[^a-z0-9]/g, '') || 'bin';
  const sourcePath = path.join(sessionDir, `source.${safeExt}`);
  fs.writeFileSync(sourcePath, fileBuffer);

  // 6. Direct routing to converted or direct rendering
  if (type === 'pdf' || CDC_IMAGE_TYPES.has(type)) {
    return { pdfPath: sourcePath, sessionDir };
  }

  try {
    const pdfPath = await convertToPDF(sourcePath, sessionDir);
    return { pdfPath, sessionDir };
  } catch (convError: any) {
    // If conversion fails, clean up the session dir immediately
    cleanupSession(sessionDir);
    throw convError;
  }
}

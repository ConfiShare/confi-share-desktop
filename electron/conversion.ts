import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';

// Secure temporary conversion directory inside the secure Electron userData folder
const CONVERSIONS_DIR = path.join(app.getPath('userData'), 'temp_conversions');

// Active sequential promise-based queue for conversion tasks
let activeQueue: Promise<any> = Promise.resolve();

// Cached path of the LibreOffice executable once detected
let detectedSofficePath: string | null = null;

/**
 * Searches the host machine for the LibreOffice "soffice" executable.
 * Checks standard install locations on Windows, macOS, and Linux, falling back to PATH.
 */
export function getLibreOfficePath(): string {
  if (detectedSofficePath) return detectedSofficePath as string;

  const platform = process.platform;
  const possiblePaths: string[] = [];
  const execName = platform === 'win32' ? 'soffice.exe' : 'soffice';
  const bundledSubPath = path.join('libreoffice', 'program', execName);
  const appRoot = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : process.cwd();

  // Bundled app resources (development and production)
  possiblePaths.push(path.join(app.getAppPath(), 'resources', bundledSubPath));
  possiblePaths.push(path.join(path.dirname(app.getAppPath()), 'resources', bundledSubPath));
  possiblePaths.push(path.join(appRoot, 'resources', bundledSubPath));
  possiblePaths.push(path.join(process.resourcesPath, bundledSubPath));
  possiblePaths.push(path.join(process.cwd(), 'resources', bundledSubPath));
  possiblePaths.push(path.join(process.cwd(), '..', 'resources', bundledSubPath));

  if (platform === 'win32') {
    // Windows standard locations
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    possiblePaths.push(
      path.join(programFiles, 'LibreOffice', 'program', execName),
      path.join(programFilesX86, 'LibreOffice', 'program', execName)
    );
  } else if (platform === 'darwin') {
    // macOS standard locations
    possiblePaths.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  } else {
    // Linux standard locations
    possiblePaths.push(
      '/usr/bin/soffice',
      '/usr/bin/libreoffice',
      '/usr/local/bin/soffice',
      '/usr/bin/soffice.bin'
    );
  }

  // Find the first path that exists
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      detectedSofficePath = p;
      console.log(`[LibreOffice] Detected soffice executable at: ${p}`);
      return p;
    }
  }

  // Fallback to searching PATH by returning the executable name — allow the OS PATH to resolve it
  detectedSofficePath = execName;
  console.log('[LibreOffice] soffice executable not found in standard paths; falling back to global PATH lookup.');
  return detectedSofficePath;
}

/**
 * Detects the file extension and MIME type using magic byte signatures (headers).
 */
export function detectFileType(buffer: Buffer, originalMime?: string, originalName?: string): { ext: string; mime: string } {
  const byExtension = (name?: string): { ext: string; mime: string } | null => {
    if (!name) return null;
    const ext = path.extname(name).toLowerCase();
    if (ext === '.pdf') return { ext: '.pdf', mime: 'application/pdf' };
    if (ext === '.txt') return { ext: '.txt', mime: 'text/plain' };
    if (ext === '.csv') return { ext: '.csv', mime: 'text/csv' };
    if (ext === '.rtf') return { ext: '.rtf', mime: 'application/rtf' };
    if (ext === '.docx') return { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    if (ext === '.doc') return { ext: '.doc', mime: 'application/msword' };
    if (ext === '.odt') return { ext: '.odt', mime: 'application/vnd.oasis.opendocument.text' };
    if (ext === '.xlsx') return { ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    if (ext === '.xls') return { ext: '.xls', mime: 'application/vnd.ms-excel' };
    if (ext === '.ods') return { ext: '.ods', mime: 'application/vnd.oasis.opendocument.spreadsheet' };
    if (ext === '.pptx') return { ext: '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
    if (ext === '.ppt') return { ext: '.ppt', mime: 'application/vnd.ms-powerpoint' };
    if (ext === '.odp') return { ext: '.odp', mime: 'application/vnd.oasis.opendocument.presentation' };
    if (ext === '.png') return { ext: '.png', mime: 'image/png' };
    if (ext === '.jpg' || ext === '.jpeg') return { ext, mime: 'image/jpeg' };
    if (ext === '.gif') return { ext: '.gif', mime: 'image/gif' };
    if (ext === '.bmp') return { ext: '.bmp', mime: 'image/bmp' };
    if (ext === '.webp') return { ext: '.webp', mime: 'image/webp' };
    if (ext === '.svg') return { ext: '.svg', mime: 'image/svg+xml' };
    if (ext === '.tif' || ext === '.tiff') return { ext, mime: 'image/tiff' };
    if (ext === '.ico') return { ext: '.ico', mime: 'image/x-icon' };
    if (ext === '.avif') return { ext: '.avif', mime: 'image/avif' };
    return null;
  };

  if (buffer.length >= 4) {
    const magic4 = buffer.toString('hex', 0, 4).toUpperCase();

    if (magic4 === '25504446') return { ext: '.pdf', mime: 'application/pdf' };
    if (magic4 === '89504E47') return { ext: '.png', mime: 'image/png' };
    if (magic4 === '47494638') return { ext: '.gif', mime: 'image/gif' };
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return { ext: '.jpg', mime: 'image/jpeg' };
    if (buffer.toString('hex', 0, 2).toUpperCase() === '424D') return { ext: '.bmp', mime: 'image/bmp' };
    if (buffer.toString('hex', 0, 4).toUpperCase() === '00000100') return { ext: '.ico', mime: 'image/x-icon' };
    if (
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return { ext: '.webp', mime: 'image/webp' };
    }

    const magicTiff = buffer.toString('hex', 0, 4).toUpperCase();
    if (magicTiff === '49492A00' || magicTiff === '4D4D002A') {
      return { ext: '.tiff', mime: 'image/tiff' };
    }

    if (buffer.toString('utf8', 0, 5) === '{\\rtf') {
      return { ext: '.rtf', mime: 'application/rtf' };
    }

    if (magic4 === '504B0304') {
      if (originalMime) {
        if (originalMime.includes('word') || originalMime.includes('docx')) return { ext: '.docx', mime: originalMime };
        if (originalMime.includes('sheet') || originalMime.includes('xlsx') || originalMime.includes('excel')) return { ext: '.xlsx', mime: originalMime };
        if (originalMime.includes('presentation') || originalMime.includes('pptx') || originalMime.includes('powerpoint')) return { ext: '.pptx', mime: originalMime };
        if (originalMime.includes('vnd.oasis.opendocument.text')) return { ext: '.odt', mime: originalMime };
        if (originalMime.includes('vnd.oasis.opendocument.spreadsheet')) return { ext: '.ods', mime: originalMime };
        if (originalMime.includes('vnd.oasis.opendocument.presentation')) return { ext: '.odp', mime: originalMime };
      }

      const extMatch = byExtension(originalName);
      if (extMatch) return extMatch;

      const zipString = buffer.toString('utf8');
      if (zipString.includes('word/')) return { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      if (zipString.includes('xl/')) return { ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
      if (zipString.includes('ppt/')) return { ext: '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
      if (zipString.includes('vnd.oasis.opendocument.text')) return { ext: '.odt', mime: 'application/vnd.oasis.opendocument.text' };
      if (zipString.includes('vnd.oasis.opendocument.spreadsheet')) return { ext: '.ods', mime: 'application/vnd.oasis.opendocument.spreadsheet' };
      if (zipString.includes('vnd.oasis.opendocument.presentation')) return { ext: '.odp', mime: 'application/vnd.oasis.opendocument.presentation' };
      return { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    }

    const magic8 = buffer.toString('hex', 0, 8).toUpperCase();
    if (magic8 === 'D0CF11E0A1B11AE1') {
      if (originalMime) {
        if (originalMime.includes('msword') || originalMime.includes('word')) return { ext: '.doc', mime: originalMime };
        if (originalMime.includes('excel') || originalMime.includes('sheet')) return { ext: '.xls', mime: originalMime };
        if (originalMime.includes('powerpoint') || originalMime.includes('presentation')) return { ext: '.ppt', mime: originalMime };
      }
      const extMatch = byExtension(originalName);
      if (extMatch && ['.doc', '.xls', '.ppt'].includes(extMatch.ext)) return extMatch;
      return { ext: '.doc', mime: 'application/msword' };
    }
  }

  const headerSnippet = buffer.toString('utf8', 0, 256).trim().toLowerCase();
  if (headerSnippet.startsWith('<svg')) {
    return { ext: '.svg', mime: 'image/svg+xml' };
  }

  if (originalMime) {
    if (originalMime === 'application/pdf') return { ext: '.pdf', mime: 'application/pdf' };
    if (originalMime === 'text/plain') return { ext: '.txt', mime: 'text/plain' };
    if (originalMime.includes('csv')) return { ext: '.csv', mime: 'text/csv' };
    if (originalMime.includes('image/')) {
      if (originalMime.includes('png')) return { ext: '.png', mime: originalMime };
      if (originalMime.includes('jpeg') || originalMime.includes('jpg')) return { ext: '.jpg', mime: originalMime };
      if (originalMime.includes('gif')) return { ext: '.gif', mime: originalMime };
      if (originalMime.includes('bmp')) return { ext: '.bmp', mime: originalMime };
      if (originalMime.includes('webp')) return { ext: '.webp', mime: originalMime };
      if (originalMime.includes('svg')) return { ext: '.svg', mime: originalMime };
      if (originalMime.includes('tiff')) return { ext: '.tiff', mime: originalMime };
      if (originalMime.includes('icon')) return { ext: '.ico', mime: originalMime };
      if (originalMime.includes('avif')) return { ext: '.avif', mime: originalMime };
    }
  }

  const extMatch = byExtension(originalName);
  if (extMatch) return extMatch;

  return { ext: '.txt', mime: 'text/plain' };
}

/**
 * Ensures that the root temp conversions directory exists, and cleans up any stale files.
 */
export function ensureConversionDirReady(): void {
  try {
    if (fs.existsSync(CONVERSIONS_DIR)) {
      // Clear any stale session subdirectories for robust startup cleanup
      fs.rmSync(CONVERSIONS_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(CONVERSIONS_DIR, { recursive: true });
  } catch (error) {
    console.error('[LibreOffice] Failed to initialise conversions temp directory:', error);
  }
}



/**
 * Runs the conversion command. Wraps child_process.execFile with timeout protection.
 */
function runSofficeConversion(sofficePath: string, args: string[], timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = execFile(sofficePath, args, (error, stdout, stderr) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (error) {
        console.error('[LibreOffice] soffice execution error:', error);
        console.error('[LibreOffice] stderr:', stderr);
        console.log('[LibreOffice] stdout:', stdout);
        return reject(new Error(`LibreOffice conversion failed: ${error.message}`));
      }
      resolve();
    });

    const timeoutTimer = setTimeout(() => {
      console.warn(`[LibreOffice] Conversion timed out after ${timeoutMs / 1000}s. Killing soffice...`);
      process.kill('SIGKILL');
      reject(new Error('LibreOffice conversion timed out. Please try again.'));
    }, timeoutMs);
  });
}

/**
 * Enqueues an Office buffer for conversion to PDF in a secure queue-safe, session-safe temp directory.
 * Sequential execution prevents LibreOffice profile locks and protects system performance.
 */
export function convertToPdfSecurely(
  docId: string,
  buffer: Buffer,
  originalMime?: string,
  originalName?: string
): Promise<Buffer> {
  // Chain this conversion task to the active sequential promise queue
  const conversionTask = activeQueue.then(async () => {
    // 1. Detect file type and assign secure temp file extension
    const fileType = detectFileType(buffer, originalMime, originalName);
    console.log(`[LibreOffice] Detected format for docId ${docId}: ${fileType.ext} (${fileType.mime})`);

    // If it's already a PDF, return the buffer directly
    if (fileType.ext === '.pdf') {
      return buffer;
    }

    // 2. Setup randomized secure temporary directories
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    const sessionDir = path.join(CONVERSIONS_DIR, `${docId}_${randomSuffix}`);
    const inputPath = path.join(sessionDir, `input${fileType.ext}`);
    const expectedPdfPath = path.join(sessionDir, 'input.pdf');

    try {
      fs.mkdirSync(sessionDir, { recursive: true });

      // Write raw buffer securely to private session dir
      fs.writeFileSync(inputPath, buffer);

      // 3. Setup LibreOffice executable and headless arguments
      const sofficePath = getLibreOfficePath();
      
      // We set a unique user profile for this process to avoid locking issues in parallel runs if they occur
      const userProfileDir = path.join(sessionDir, 'profile');
      
      const args = [
        '--headless',
        `-env:UserInstallation=file:///${userProfileDir.replace(/\\/g, '/')}`,
        '--convert-to',
        'pdf',
        inputPath,
        '--outdir',
        sessionDir
      ];

      console.log(`[LibreOffice] Starting conversion for docId ${docId} using userProfileDir: ${userProfileDir}`);
      
      // Execute the headless conversion
      await runSofficeConversion(sofficePath, args);

      // Check if output PDF exists
      if (!fs.existsSync(expectedPdfPath)) {
        throw new Error('LibreOffice finished converting but no PDF output was found.');
      }

      // 4. Read generated PDF into memory buffer
      const pdfBuffer = fs.readFileSync(expectedPdfPath);
      console.log(`[LibreOffice] Successfully converted docId ${docId} to PDF, size: ${pdfBuffer.length} bytes.`);
      
      return pdfBuffer;
    } finally {
      // 5. SECURE CLEANUP: Wipe and destroy temporary session directory immediately
      try {
        if (fs.existsSync(inputPath)) {
          // Overwrite input file with zeros before deleting to prevent recovery
          const size = fs.statSync(inputPath).size;
          const zeros = Buffer.alloc(size);
          fs.writeFileSync(inputPath, zeros);
        }
        if (fs.existsSync(expectedPdfPath)) {
          // Overwrite output file with zeros before deleting
          const size = fs.statSync(expectedPdfPath).size;
          const zeros = Buffer.alloc(size);
          fs.writeFileSync(expectedPdfPath, zeros);
        }
      } catch (cleanupErr) {
        console.warn('[LibreOffice] Failed to safely overwrite temporary files during shredding:', cleanupErr);
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

  // Update the global active queue pointer to point to the tail of our task sequence
  activeQueue = conversionTask.catch((err) => {
    // Log queue failures but do not break the chain for subsequent conversion tasks
    console.error('[LibreOffice] Conversion queue item failed:', err);
  });

  return conversionTask;
}

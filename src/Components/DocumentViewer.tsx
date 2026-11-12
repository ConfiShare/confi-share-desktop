import { useEffect, useRef, useState } from 'react';
import { FileText, ImageIcon, Loader2, ShieldAlert, ArrowLeft, History } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { PdfViewer } from './PdfViewer';
import { useApp } from '../store/AppContext';
import { featureFlags } from '../config/featureFlags';
import { DocumentActivityPanel } from './tracking/DocumentActivityPanel';
import type { ConfiDocument } from '../types';
import {
  buildOfficePreview,
  detectImageMimeFromBytes,
  isDirectOfficePreviewType,
  type OfficePreviewData,
} from './officePreview';

interface DocumentViewerProps {
  doc: ConfiDocument;
}

type ViewerMode = 'pdf' | 'image' | 'office';

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0) return '';
  return fileName.slice(dotIndex).toLowerCase();
}

function getImageMimeFromFileName(fileName: string): string | null {
  const ext = getFileExtension(fileName);
  return IMAGE_MIME_BY_EXTENSION[ext] ?? null;
}

function isPdfFile(fileName: string, mimeType: string): boolean {
  return mimeType === 'application/pdf' || getFileExtension(fileName) === '.pdf';
}

function isImageFile(fileName: string, mimeType: string): boolean {
  if (mimeType.startsWith('image/')) return true;
  return Boolean(getImageMimeFromFileName(fileName));
}

/**
 * For .cdc documents the real file type is inside the container (meta.mime /
 * meta.originalName). The type of the imported .cdc file itself is meaningless
 * ('' / application/json / application/octet-stream), so never use it.
 */
function getCdcMeta(doc: ConfiDocument): { mime: string; originalName: string } | null {
  if (!doc.cdcContainer) return null;
  const meta = doc.cdcContainer.meta as unknown as Record<string, unknown>;
  const mime = typeof meta.mime === 'string' ? meta.mime : '';
  const nameField = [meta.originalName, meta.fileName, meta.name, meta.filename].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  return { mime, originalName: nameField ?? '' };
}

/** File name used to decide how to render (the original name for .cdc documents). */
function resolveViewName(doc: ConfiDocument): string {
  return getCdcMeta(doc)?.originalName || doc.name;
}

function isPdfBytes(bytes: Uint8Array): boolean {
  // "%PDF-" usually at byte 0, but the spec allows junk before it (first 1 KB).
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i += 1) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) {
      return true;
    }
  }
  return false;
}

function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** True only for real text (no NUL bytes, valid UTF-8), so binary files are never shown as text. */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.includes(0)) return false;
  // The sample may end in the middle of a multi-byte character; allow up to 3 trailing bytes.
  for (let trim = 0; trim <= 3 && trim < sample.length; trim += 1) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, sample.length - trim));
      return true;
    } catch {
      // try a shorter sample
    }
  }
  return false;
}

function resolveKnownMimeType(doc: ConfiDocument): string {
  const cdcMime = getCdcMeta(doc)?.mime;
  if (cdcMime) return cdcMime;

  const fromBlob = doc.fileObject?.type ?? '';
  if (fromBlob) return fromBlob;

  const fromContainer = doc.cdcContainer?.meta.mime ?? '';
  if (fromContainer) return fromContainer;

  return getImageMimeFromFileName(doc.name) ?? '';
}

function base64ToUint8Array(base64Data: string): Uint8Array {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Utility to convert an in-memory Uint8Array into a base64 string efficiently.
 * Uses chunking to prevent stack overflows on large files.
 */
function uint8ArrayToBase64(uint8: Uint8Array): string {
  let binary = '';
  const len = uint8.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = uint8.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

export function DocumentViewer({ doc }: DocumentViewerProps) {
  const { navigateTo } = useApp();
  const [viewerMode, setViewerMode] = useState<ViewerMode | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [officePreview, setOfficePreview] = useState<OfficePreviewData | null>(null);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  // Opens are recorded server-side by POST /drm/activate (sent with the
  // signed-in user's token in drmService), so nothing to report here.
  const currentDocIdRef = useRef<string | null>(null);
  const generatedImageUrlRef = useRef<string | null>(null);

  const mimeType = resolveKnownMimeType(doc);
  const viewName = resolveViewName(doc);
  const shouldRenderAsPdf = isPdfFile(viewName, mimeType);
  const shouldRenderAsImage = isImageFile(viewName, mimeType);
  const shouldRenderAsDirectOfficePreview = isDirectOfficePreviewType(viewName, mimeType);

  function releaseGeneratedImageUrl() {
    if (generatedImageUrlRef.current) {
      URL.revokeObjectURL(generatedImageUrlRef.current);
      generatedImageUrlRef.current = null;
    }
  }

  async function readDecryptedCdcBytes(localPath: string, passKey: string): Promise<Uint8Array> {
    const containerBytes = await window.drmApi.readLocalFile(localPath);
    const containerText = new TextDecoder('utf-8', { fatal: false }).decode(containerBytes);
    const containerJson = JSON.parse(containerText);
    const decrypted = await window.drmApi.decryptCDC(containerJson, passKey);
    const payload = JSON.parse(decrypted.decryptedPayload) as { file?: string };
    if (!payload.file) {
      throw new Error('Invalid secure document payload.');
    }
    return base64ToUint8Array(payload.file);
  }

  useEffect(() => {
    // Enable content protection while this viewer is active and block copy/drag events
    try {
      const wc = (window as unknown as Window & { windowControls?: { setContentProtection: (enable: boolean) => Promise<boolean> } }).windowControls
      if (wc?.setContentProtection) {
        wc.setContentProtection(true).catch((err) => {
          console.debug('setContentProtection(enable) failed', err)
        })
      }
    } catch (err) {
      console.debug('Failed to request content protection (enable)', err)
    }

    function onCopy(e: ClipboardEvent) {
      e.preventDefault()
      try {
        if (e.clipboardData) e.clipboardData.clearData()
      } catch (err) {
        console.debug('Failed to clear clipboard data', err)
      }
    }

    function onCut(e: ClipboardEvent) {
      e.preventDefault()
    }

    function onDragStart(e: DragEvent) {
      e.preventDefault()
    }

    function onKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      const blocked = ['c', 's', 'p']
      if (blocked.includes(e.key.toLowerCase())) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    document.addEventListener('copy', onCopy, true)
    document.addEventListener('cut', onCut, true)
    document.addEventListener('dragstart', onDragStart, true)
    document.addEventListener('keydown', onKeyDown, true)

    async function readDocumentBytesFromSource(): Promise<Uint8Array> {
      if (doc.fileUrl) {
        const response = await fetch(doc.fileUrl);
        if (!response.ok) {
          throw new Error('Failed to read document from memory storage.');
        }
        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      }

      if (doc.localPath && !doc.cdcContainer) {
        return await window.drmApi.readLocalFile(doc.localPath);
      }

      if (doc.cdcContainer && doc.localPath) {
        if (!doc.accessCode) {
          throw new Error('Access code required to decrypt this secure document.');
        }
        return await readDecryptedCdcBytes(doc.localPath, doc.accessCode);
      }

      throw new Error('Document source is missing.');
    }

    let active = true;
    currentDocIdRef.current = doc.id;

    // Reset states
    setIsConverting(false);
    setConversionError(null);
    setPdfData(null);
    setImageUrl(null);
    setOfficePreview(null);
    setViewerMode(null);
    releaseGeneratedImageUrl();

    function isStale() {
      return !active || currentDocIdRef.current !== doc.id;
    }

    function showImage(bytes: Uint8Array, imageMime: string) {
      const objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: imageMime }));
      generatedImageUrlRef.current = objectUrl;
      setViewerMode('image');
      setImageUrl(objectUrl);
    }

    /**
     * .cdc documents: decrypt once, then pick the viewer from the real content
     * (file signature first, then the type/name stored in the container).
     */
    async function loadCdcPreview() {
      const bytes = await readDocumentBytesFromSource();
      if (isStale()) return;

      if (isPdfBytes(bytes)) {
        setViewerMode('pdf');
        setPdfData(bytes);
        return;
      }

      const imageMime =
        detectImageMimeFromBytes(bytes) ??
        (shouldRenderAsImage ? mimeType || getImageMimeFromFileName(viewName) : null);
      if (imageMime) {
        showImage(bytes, imageMime);
        return;
      }

      // Word / Excel / PowerPoint / OpenDocument / CSV / text: built-in preview.
      // Text preview only for real text, so binary content is never shown as characters.
      if (isZipBytes(bytes) || shouldRenderAsDirectOfficePreview || looksLikeText(bytes)) {
        try {
          const preview = await buildOfficePreview(bytes, viewName, mimeType);
          if (isStale()) return;
          if (preview) {
            setViewerMode('office');
            setOfficePreview(preview);
            return;
          }
        } catch (previewErr) {
          console.warn('[Viewer] Built-in preview failed, trying PDF conversion:', previewErr);
        }
      }

      // Everything else (e.g. old .doc / .xls / .ppt): convert to PDF.
      const pdfBytes = await window.drmApi.convertToPdf(doc.id, uint8ArrayToBase64(bytes), viewName, mimeType);
      if (isStale()) return;
      setViewerMode('pdf');
      setPdfData(pdfBytes);
    }

    async function loadDocumentPreview() {
      setIsConverting(true);
      setConversionError(null);

      try {
        if (doc.cdcContainer) {
          await loadCdcPreview();
          return;
        }

        if (shouldRenderAsImage) {
          if (doc.fileUrl) {
            if (!active || currentDocIdRef.current !== doc.id) return;
            setViewerMode('image');
            setImageUrl(doc.fileUrl);
            return;
          }

          if (doc.localPath && !doc.cdcContainer) {
            const bytes = await window.drmApi.readLocalFile(doc.localPath);
            if (!active || currentDocIdRef.current !== doc.id) return;

            const imageMime = mimeType || getImageMimeFromFileName(doc.name) || 'application/octet-stream';
            const localObjectUrl = URL.createObjectURL(
              new Blob([Uint8Array.from(bytes)], { type: imageMime })
            );
            generatedImageUrlRef.current = localObjectUrl;
            setViewerMode('image');
            setImageUrl(localObjectUrl);
            return;
          }

          if (doc.cdcContainer && doc.localPath) {
            if (!doc.accessCode) {
              throw new Error('Access code required to decrypt this secure document.');
            }
            const bytes = await readDecryptedCdcBytes(doc.localPath, doc.accessCode);
            if (!active || currentDocIdRef.current !== doc.id) return;

            const imageMime = mimeType || getImageMimeFromFileName(doc.name) || 'application/octet-stream';
            const secureImageUrl = URL.createObjectURL(
              new Blob([Uint8Array.from(bytes)], { type: imageMime })
            );
            generatedImageUrlRef.current = secureImageUrl;
            setViewerMode('image');
            setImageUrl(secureImageUrl);
            return;
          }

          throw new Error('Image source is missing.');
        }

        if (shouldRenderAsPdf) {
          if (doc.fileUrl) {
            if (!active || currentDocIdRef.current !== doc.id) return;
            setViewerMode('pdf');
            setPdfData(doc.fileUrl);
            return;
          }

          if (doc.localPath && !doc.cdcContainer) {
            const bytes = await window.drmApi.readLocalFile(doc.localPath);
            if (!active || currentDocIdRef.current !== doc.id) return;
            setViewerMode('pdf');
            setPdfData(bytes);
            return;
          }

          if (doc.cdcContainer && doc.localPath) {
            if (!doc.accessCode) {
              throw new Error('Access code required to decrypt this secure document.');
            }
            const bytes = await readDecryptedCdcBytes(doc.localPath, doc.accessCode);
            if (!active || currentDocIdRef.current !== doc.id) return;
            setViewerMode('pdf');
            setPdfData(bytes);
            return;
          }

          throw new Error('Document source is missing.');
        }

        if (shouldRenderAsDirectOfficePreview) {
          const sourceBytes = await readDocumentBytesFromSource();
          if (!active || currentDocIdRef.current !== doc.id) return;

          try {
            const preview = await buildOfficePreview(sourceBytes, doc.name, mimeType);
            if (preview) {
              if (!active || currentDocIdRef.current !== doc.id) return;
              setViewerMode('office');
              setOfficePreview(preview);
              return;
            }
            console.warn('[Viewer] Direct office preview returned no preview, falling back to secure conversion:', doc.name);
          } catch (previewErr) {
            console.warn('[Viewer] Direct office preview failed, falling back to secure conversion:', previewErr);
          }
        }

        console.log(`[Viewer] Initiating secure PDF conversion: ${doc.name} (${mimeType || 'unknown'})`);

        const sourceBytes = await readDocumentBytesFromSource();
        if (!active || currentDocIdRef.current !== doc.id) return;

        const detectedImageMime = detectImageMimeFromBytes(sourceBytes);
        if (detectedImageMime) {
          const objectUrl = URL.createObjectURL(
            new Blob([Uint8Array.from(sourceBytes)], { type: detectedImageMime })
          );
          generatedImageUrlRef.current = objectUrl;
          setViewerMode('image');
          setImageUrl(objectUrl);
          return;
        }

        try {
          const fallbackOfficePreview = await buildOfficePreview(sourceBytes, doc.name, mimeType);
          if (fallbackOfficePreview) {
            if (!active || currentDocIdRef.current !== doc.id) return;
            setViewerMode('office');
            setOfficePreview(fallbackOfficePreview);
            return;
          }
        } catch (previewErr) {
          console.warn('[Viewer] Built-in office preview fallback failed, trying PDF conversion path:', previewErr);
        }

        const base64Data = uint8ArrayToBase64(sourceBytes);
        const pdfBytes = await window.drmApi.convertToPdf(
          doc.id,
          base64Data,
          doc.name,
          mimeType
        );

        if (!active || currentDocIdRef.current !== doc.id) return;
        setViewerMode('pdf');
        setPdfData(pdfBytes);
      } catch (err: unknown) {
        console.error('[Viewer] Failed to load/convert document:', err);
        if (active && currentDocIdRef.current === doc.id) {
          const rawMessage = err instanceof Error ? err.message : String(err || 'Failed to load and display document securely.');
          if (/soffice\s+ENOENT/i.test(rawMessage)) {
            setConversionError(
              'Built-in Office conversion is unavailable for this format on this device. ' +
              'Use DOCX/XLSX/PPTX/ODT/ODS/ODP/CSV/TXT/RTF and image files for direct in-app preview.'
            );
          } else {
            setConversionError(rawMessage);
          }
        }
      } finally {
        if (active && currentDocIdRef.current === doc.id) {
          setIsConverting(false);
        }
      }
    }

    loadDocumentPreview();

    return () => {
      active = false;
      releaseGeneratedImageUrl();
      try {
        const wc = (window as unknown as Window & { windowControls?: { setContentProtection: (enable: boolean) => Promise<boolean> } }).windowControls
        if (wc?.setContentProtection) {
          wc.setContentProtection(false).catch((err) => {
            console.debug('setContentProtection(disable) failed', err)
          })
        }
      } catch (err) {
        console.debug('Failed to request content protection (disable)', err)
      }

      document.removeEventListener('copy', onCopy, true)
      document.removeEventListener('cut', onCut, true)
      document.removeEventListener('dragstart', onDragStart, true)
      document.removeEventListener('keydown', onKeyDown, true)
    };
  }, [
    doc.accessCode,
    doc.cdcContainer,
    doc.fileUrl,
    doc.id,
    doc.localPath,
    doc.name,
    mimeType,
    shouldRenderAsDirectOfficePreview,
    shouldRenderAsImage,
    shouldRenderAsPdf,
    viewName,
  ]);

  return (
    <div 
      className="flex-1 flex flex-col h-full bg-slate-900 overflow-hidden"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Dynamic Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigateTo('home')}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            title="Back to document list"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-gray-800 truncate max-w-md" title={viewName}>
            {viewName}
          </span>
          <StatusBadge status={doc.status} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {featureFlags.trackingPreview && (
            <button
              type="button"
              onClick={() => setShowActivity((v) => !v)}
              aria-pressed={showActivity}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full cursor-pointer transition-colors ${
                showActivity
                  ? 'bg-emerald-50 text-[#059669]'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
              title="Show tracking and activity history"
            >
              <History className="w-3.5 h-3.5" />
              Activity
            </button>
          )}
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 bg-slate-100 px-3 py-1 rounded-full select-none">
            Secure Reader Mode
          </div>
        </div>
      </div>

      <div className="flex-1 flex relative overflow-hidden min-h-0">
      {/* Main Content Area */}
      <div className="flex-1 relative overflow-hidden bg-[#475569]/90">
        {isConverting ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
            <div className="text-center">
              <p className="text-sm font-bold text-slate-800">Secure Document Processing...</p>
              <p className="text-xs text-slate-400 mt-1">Preparing secure in-app preview in memory.</p>
            </div>
          </div>
        ) : conversionError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 p-8 gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center text-rose-500">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div>
              <p className="text-base font-bold text-slate-800">Security & Rendering Notice</p>
              <p className="text-xs text-slate-400 mt-1.5 max-w-md leading-relaxed">
                We could not load this file to a secure preview format.
                Please ensure the file is a valid supported format.
              </p>
              <div className="mt-4 p-3 bg-slate-100 rounded-lg text-left max-w-lg mx-auto">
                <p className="text-[11px] font-mono text-slate-500 wrap-break-word leading-normal">
                  Error Details: {conversionError}
                </p>
              </div>

              {/* no additional guidance UI */}
            </div>
          </div>
        ) : viewerMode === 'pdf' && pdfData ? (
          <PdfViewer pdfData={pdfData} fileName={doc.name} />
        ) : viewerMode === 'image' && imageUrl ? (
          <div className="absolute inset-0 bg-slate-800 p-6 flex items-center justify-center">
            <img
              src={imageUrl}
              alt={doc.name}
              className="max-h-full max-w-full object-contain select-none"
              draggable={false}
            />
          </div>
        ) : viewerMode === 'office' && officePreview ? (
          <div className="absolute inset-0 bg-slate-50 overflow-auto p-6">
            <div className="max-w-6xl mx-auto bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
                <p className="text-sm font-semibold text-slate-700">{officePreview.title}</p>
              </div>
              <div
                className="p-5 text-sm text-slate-800 leading-relaxed overflow-auto"
                style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
                onCopy={(e) => e.preventDefault()}
                onCut={(e) => e.preventDefault()}
                onDragStart={(e) => e.preventDefault()}
                dangerouslySetInnerHTML={{ __html: officePreview.html }}
              />
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 text-slate-400 gap-3">
            {shouldRenderAsImage ? (
              <ImageIcon className="w-12 h-12 opacity-30" />
            ) : (
              <FileText className="w-12 h-12 opacity-30" />
            )}
            <p className="text-sm font-medium">Unable to render document</p>
          </div>
        )}
      </div>

      {/* Tracking & activity history (UI preview, sample data) */}
      {featureFlags.trackingPreview && showActivity && (
        <DocumentActivityPanel doc={doc} onClose={() => setShowActivity(false)} />
      )}
      </div>
    </div>
  );
}

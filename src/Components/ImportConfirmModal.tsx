import { useMemo, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import JSZip from 'jszip';
import { Modal } from './Modal';
import { useApp } from '../store/AppContext';
import type { CdcContainer, ConfiDocument } from '../types';

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function generateCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function getPdfPageCount(file: File): Promise<number> {
  // Read as ArrayBuffer and scan for /Type /Page markers — lightweight, no lib needed
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        // Count occurrences of /Type /Page (each real page object in a PDF)
        const matches = text.match(/\/Type\s*\/Page[^s]/g);
        resolve(matches ? matches.length : 1);
      } catch {
        resolve(1);
      }
    };
    reader.onerror = () => resolve(1);
    reader.readAsBinaryString(file);
  });
}

function isCdcContainer(value: unknown): value is CdcContainer {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const meta = obj.meta;
  if (typeof meta !== 'object' || meta === null) return false;
  const metaObj = meta as Record<string, unknown>;
  return typeof metaObj.mime === 'string';
}

function getFileExt(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0) return '';
  return fileName.slice(dotIndex).toLowerCase();
}

function isCdcFile(file: File): boolean {
  return getFileExt(file.name) === '.cdc';
}

function isZipFile(file: File): boolean {
  return getFileExt(file.name) === '.zip';
}

function getDisplayName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

function formatFileSize(sizeInBytes: number): string {
  const sizeInKb = Math.round(sizeInBytes / 1024);
  return sizeInKb < 1 ? '<1 kb' : `${sizeInKb} kb`;
}

async function extractCdcFilesFromZip(zipFile: File): Promise<File[]> {
  const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());

  const cdcEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.cdc')
  );

  return Promise.all(
    cdcEntries.map(async (entry, index) => {
      const buffer = await entry.async('arraybuffer');
      const baseName =
        entry.name.split('/').filter(Boolean).pop() ?? `document-${index + 1}.cdc`;

      return new File([buffer], baseName, {
        type: 'application/json',
        lastModified: zipFile.lastModified || Date.now(),
      });
    })
  );
}

async function createDocumentFromFile(file: File): Promise<ConfiDocument> {
  const cdcFile = isCdcFile(file);
  let cdcContainer: CdcContainer | null = null;
  let totalPages: number | undefined;
  let fileUrl = '';

  if (cdcFile) {
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);

    if (!isCdcContainer(parsed)) {
      throw new Error('Invalid .cdc container: missing meta.mime');
    }

    cdcContainer = parsed;
  } else {
    fileUrl = URL.createObjectURL(file);

    if (file.type === 'application/pdf' || getFileExt(file.name) === '.pdf') {
      totalPages = await getPdfPageCount(file);
    }
  }

  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + 3);

  return {
    id: generateId(),
    name: file.name,
    displayName: getDisplayName(file.name),
    status: 'active',
    expiresAt: expiry,
    accessCode: generateCode(),
    sizeKb: Math.round(file.size / 1024),
    fileObject: file,
    fileUrl,
    totalPages,
    cdcContainer: cdcContainer ?? undefined,
    isLocked: cdcFile,
  };
}

export function ImportConfirmModal() {
  const { closeModal, openModal, modal, addDocument } = useApp();
  const [loading, setLoading] = useState(false);
  const pendingFiles = modal.pendingFiles ?? [];

  const totalSize = useMemo(
    () => pendingFiles.reduce((sum, selectedFile) => sum + selectedFile.size, 0),
    [pendingFiles]
  );

  if (pendingFiles.length === 0) return null;

  async function handleContinue() {
    if (pendingFiles.length === 0) return;
    setLoading(true);

    try {
      let importedCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (const selectedFile of pendingFiles) {
        if (isZipFile(selectedFile)) {
          try {
            const zippedCdcFiles = await extractCdcFilesFromZip(selectedFile);

            if (zippedCdcFiles.length === 0) {
              failedCount += 1;
              errors.push(`${selectedFile.name}: no .cdc file found inside zip`);
              continue;
            }

            for (const extractedFile of zippedCdcFiles) {
              try {
                const newDoc = await createDocumentFromFile(extractedFile);
                await addDocument(newDoc);
                importedCount += 1;
              } catch (error) {
                failedCount += 1;
                errors.push(
                  `${selectedFile.name} > ${extractedFile.name}: ${getErrorMessage(error)}`
                );
              }
            }
          } catch (error) {
            failedCount += 1;
            errors.push(`${selectedFile.name}: ${getErrorMessage(error)}`);
          }
          continue;
        }

        try {
          const newDoc = await createDocumentFromFile(selectedFile);
          await addDocument(newDoc);
          importedCount += 1;
        } catch (error) {
          failedCount += 1;
          errors.push(`${selectedFile.name}: ${getErrorMessage(error)}`);
        }
      }

      if (importedCount === 0) {
        const shortErrorList = errors.slice(0, 3).join('\n');
        alert(
          `No documents were imported.\n${
            shortErrorList || 'Please ensure the files are valid .cdc or .zip containers.'
          }`
        );
        return;
      }

      openModal({
        type: 'import_success',
        importSummary: { importedCount, failedCount },
      });

      if (failedCount > 0) {
        const shortErrorList = errors.slice(0, 3).join('\n');
        alert(
          `Imported ${importedCount} document(s), but ${failedCount} failed.\n${shortErrorList}${
            errors.length > 3 ? '\n...' : ''
          }`
        );
      }
    } catch (error) {
      console.error('Failed to import document:', error);
      alert('Failed to import document(s). Please check that the selected file(s) are valid.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal onClose={closeModal}>
      <div className="flex flex-col items-center px-8 py-10">
        {/* File icon circle */}
        <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <FileText className="w-6 h-6 text-gray-700" />
        </div>

        <h2 className="text-[1.125rem] font-semibold text-gray-900 mb-5">
          {pendingFiles.length === 1 ? 'Selected file' : 'Selected files'}
        </h2>

        {/* File card */}
        <div className="w-full bg-gray-50 rounded-xl px-4 py-3.5 mb-6">
          <p className="text-sm font-medium text-gray-800">
            {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''} selected
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{formatFileSize(totalSize)}</p>
          <div className="mt-2 space-y-1">
            {pendingFiles.slice(0, 5).map((selectedFile) => (
              <p
                key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`}
                className="text-xs text-gray-600 truncate"
                title={selectedFile.name}
              >
                {selectedFile.name}
              </p>
            ))}
            {pendingFiles.length > 5 ? (
              <p className="text-xs text-gray-400">+{pendingFiles.length - 5} more</p>
            ) : null}
          </div>
        </div>

        <button
          onClick={handleContinue}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3.5 size-14 bg-[#059669] hover:bg-green-700 active:bg-green-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-colors"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Importing...
            </>
          ) : (
            'Continue'
          )}
        </button>
      </div>
    </Modal>
  );
}

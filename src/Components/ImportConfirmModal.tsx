import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../store/AppContext';
import type { ConfiDocument } from '../types';

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

export function ImportConfirmModal() {
  const { closeModal, openModal, modal, addDocument } = useApp();
  const [loading, setLoading] = useState(false);
  const file = modal.pendingFile;

  if (!file) return null;

  const fileSizeKb = Math.round(file.size / 1024);
  const displaySize = fileSizeKb < 1 ? '<1 kb' : `${fileSizeKb} kb`;

  async function handleContinue() {
    if (!file) return;
    setLoading(true);

    try {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 3);

      // Create object URL for rendering
      const fileUrl = URL.createObjectURL(file);

      // Extract page count for PDFs
      let totalPages: number | undefined;
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        totalPages = await getPdfPageCount(file);
      }

      const newDoc: ConfiDocument = {
        id: generateId(),
        name: file.name,
        displayName: file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
        status: 'active',
        expiresAt: expiry,
        accessCode: generateCode(),
        sizeKb: fileSizeKb,
        fileObject: file,
        fileUrl,
        totalPages,
      };

      addDocument(newDoc);
      openModal({ type: 'import_success' });
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

        <h2 className="text-[1.125rem] font-semibold text-gray-900 mb-5">Selected file</h2>

        {/* File card */}
        <div className="w-full bg-gray-50 rounded-xl px-4 py-3.5 mb-6">
          <p className="text-sm font-medium text-gray-800">{file.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{displaySize}</p>
        </div>

        <button
          onClick={handleContinue}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3.5 size-14 bg-green-600 hover:bg-green-700 active:bg-green-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-colors"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            'Continue'
          )}
        </button>
      </div>
    </Modal>
  );
}
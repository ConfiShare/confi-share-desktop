import { FileText } from 'lucide-react';
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

export function ImportConfirmModal() {
  const { closeModal, openModal, modal, addDocument } = useApp();
  const file = modal.pendingFile;

  if (!file) return null;

  const fileSizeKb = Math.round(file.size / 1024);
  const displaySize = fileSizeKb < 1 ? '<1 kb' : `${fileSizeKb} kb`;

  function handleContinue() {
    if (!file) return;

    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 3);

    const newDoc: ConfiDocument = {
      id: generateId(),
      name: file.name,
      displayName: file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
      status: 'active',
      expiresAt: expiry,
      accessCode: generateCode(),
      sizeKb: fileSizeKb,
    };

    addDocument(newDoc);
    openModal({ type: 'import_success' });
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
          className="w-full py-3.5 size-14 cursor-pointer bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm rounded-xl transition-colors"
        >
          Continue
        </button>
      </div>
    </Modal>
  );
}
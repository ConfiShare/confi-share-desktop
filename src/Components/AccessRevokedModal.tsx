import { TriangleAlert } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../store/AppContext';

export function AccessRevokedModal() {
  const { closeModal, modal, removeDocument } = useApp();

  function handleRemove() {
    if (modal.documentId) {
      removeDocument(modal.documentId);
    }
    closeModal();
  }

  return (
    <Modal onClose={closeModal}>
      <div className="flex flex-col items-center px-8 py-10">
        {/* Warning icon */}
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-5">
          <TriangleAlert className="w-7 h-7 text-red-500" strokeWidth={2} />
        </div>

        <h2 className="text-[1.125rem] font-semibold text-gray-900 mb-3">
          Access revoked
        </h2>

        <p className="text-sm text-gray-500 text-center mb-7 leading-relaxed">
          This document is no longer available. The owner has withdrawn access
        </p>

        <button
          onClick={handleRemove}
          className="w-full py-3.5 size-14 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-semibold text-sm rounded-xl transition-colors"
        >
          Remove Document
        </button>
      </div>
    </Modal>
  );
}
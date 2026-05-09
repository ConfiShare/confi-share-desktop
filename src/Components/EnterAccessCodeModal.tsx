import { useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { useApp } from "../store/AppContext";
import { isAccessRevokedError } from "../services/drmService";

export function EnterAccessCodeModal() {
  const {
    closeModal,
    openModal,
    modal,
    getDocumentById,
    navigateTo,
    unlockDocument,
    markDocumentRevoked,
  } = useApp();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const doc = modal.documentId ? getDocumentById(modal.documentId) : null;
  const docName = doc?.displayName ?? 'Document';

  async function handleVerify() {
    if (!code.trim()) {
      setError('Please enter an access code');
      return;
    }
    if (!doc) {
      setError('Document not found');
      return;
    }

    setIsVerifying(true);
    setError('');

    try {
      if (doc.isLocked && doc.cdcContainer) {
        // DRM flow: Activate and Decrypt
        await unlockDocument(doc.id, code.trim());
      } else {
        // Legacy flow: Simple code match
        if (code.trim() !== doc.accessCode) {
          throw new Error('Invalid access code. Please try again.');
        }
      }

      // ✅ Success
      closeModal();
      navigateTo('document', doc.id);
    } catch (err) {
      if (doc && isAccessRevokedError(err)) {
        markDocumentRevoked(doc.id);
        closeModal();
        openModal({ type: 'access_revoked', documentId: doc.id });
        return;
      }
      const message = err instanceof Error ? err.message : 'Verification failed. Please check your code.';
      setError(message);
    } finally {
      setIsVerifying(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleVerify();
  }

  return (
    <Modal onClose={closeModal}>
      <div className="px-7 py-6">
        {/* Header */}
        <h2 className="text-[1.125rem] font-semibold text-gray-900 mb-5 pr-8">
          Enter Access Code
        </h2>

      
        <hr className="text-gray-300 mb-5" />

        {/* Document label */}
        <div className="mb-5">
          <p className="text-xs text-gray-400 font-medium tracking-wide mb-0.5">
            Document
          </p>
          <p className="text-sm font-semibold text-gray-900">{docName}</p>
        </div>


        {/* Code input */}
        <input
          type="text"
          placeholder="Enter access code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError("");
          }}
          onKeyDown={handleKeyDown}
          style={{padding:"1rem"}}
          className={`w-full text-sm text-gray-700 rounded-xl size-12 placeholder-gray-400 outline-none border pb-3 mb-4 transition-colors ${
            error ? "border-red-400" : "border-gray-200 focus:border-[#059669]"
          }`}
        />

        {/* Error message */}
        {error && <p className="text-xs text-red-500 mb-3 -mt-2">{error}</p>}

        {/* Info box */}
        <div className="flex items-start gap-3 bg-gray-50 rounded-xl px-4 py-3.5 mb-6">
          <ShieldCheck className="w-8 h-8 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500 leading-relaxed">
            Enter the access code to view this document.
            <br />
            The code was shared with you by the document owner.
          </p>
        </div>

        <button
          onClick={handleVerify}
          disabled={isVerifying}
          className="w-full flex items-center justify-center gap-2 py-3.5 size-14 bg-[#059669] hover:bg-green-700 active:bg-green-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-colors"
        >
          {isVerifying ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Verifying...
            </>
          ) : (
            'Verify & View Document'
          )}
        </button>
      </div>
    </Modal>
  );
}

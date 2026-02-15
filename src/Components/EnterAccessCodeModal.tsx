import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Modal } from "./Modal";
import { useApp } from "../store/AppContext";

export function EnterAccessCodeModal() {
  const { closeModal, modal, getDocumentById } = useApp();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const document = modal.documentId ? getDocumentById(modal.documentId) : null;
  const docName = document?.displayName ?? "Document";

  function handleVerify() {
    if (!code.trim()) {
      setError("Please enter an access code");
      return;
    }
    if (document && code.trim() !== document.accessCode) {
      setError("Invalid access code. Please try again.");
      return;
    }
    // Success - in real app would decrypt & show document
    setError("");
    alert(
      "Document verified! (In production this would decrypt and render the document)",
    );
    closeModal();
  }

  return (
    <Modal onClose={closeModal}>
      <div className="px-7 py-6">
        {/* Header */}
        <h2 className="text-[1.125rem] font-semibold text-gray-900 mb-5 pr-8">
          Enter Access Code
        </h2>

        Divider
        <div className="h-px bg-gray-100 mb-5" />

        {/* Document label */}
        <div className="mb-5">
          <p className="text-xs text-gray-400 font-medium tracking-wide mb-0.5">
            Document
          </p>
          <p className="text-sm font-semibold text-gray-900">{docName}</p>
        </div>

        {/* Divider */}
        {/* <div className="h-px bg-gray-100 mb-5" /> */}

        {/* Code input */}
        <input
          type="text"
          placeholder="Enter access code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError("");
          }}
          className={`w-full text-sm text-gray-700 placeholder-gray-400 outline-none border pb-3 mb-4 transition-colors ${
            error ? "border-red-400" : "border-gray-200 focus:border-green-500"
          }`}
        />

        {/* Error message */}
        {error && <p className="text-xs text-red-500 mb-3 -mt-2">{error}</p>}

        {/* Info box */}
        <div className="flex items-start gap-3 bg-gray-50 rounded-xl px-4 py-3.5 mb-6">
          <ShieldCheck className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500 leading-relaxed">
            Enter the access code to view this document.
            <br />
            The code was shared with you by the document owner.
          </p>
        </div>

        {/* CTA */}
        <button
          onClick={handleVerify}
          className="w-full py-3.5 size-14 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm rounded-xl transition-colors"
        >
          Verify &amp; View Document
        </button>
      </div>
    </Modal>
  );
}

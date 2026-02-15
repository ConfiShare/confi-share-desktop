import { useState } from "react";
import { Eye, EyeOff, Copy, ShieldAlert } from "lucide-react";
import { Modal } from "./Modal";
import { useApp } from "../store/AppContext";

export function ViewAccessCodeModal() {
  const { closeModal, modal, getDocumentById } = useApp();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const document = modal.documentId ? getDocumentById(modal.documentId) : null;
  const docName = document?.displayName ?? "Document";
  const code = document?.accessCode ?? "";

  function handleCopy() {
    navigator.clipboard.writeText(code).catch(() => {
      // fallback: no-op in environments without clipboard
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const displayCode = visible ? code : "•".repeat(Math.min(code.length, 28));

  return (
    <Modal onClose={closeModal}>
      <div className="px-7 py-6">
        {/* Header */}
        <h2 className="text-[1.125rem] font-semibold text-gray-900 mb-5 pr-8">
          Access Code
        </h2>

        {/* Divider */}
        <div className="bg-gray-100" ></div>

        {/* Document label */}
        <div className="mb-5">
          <p className="text-xs text-gray-400 font-medium tracking-wide mb-0.5">
            Document
          </p>
          <p className="text-sm font-semibold text-gray-900">{docName}</p>
        </div>

        {/* Divider */}
        {/* <div className="h-px bg-gray-100 mb-5" /> */}

        {/* Masked code field */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-5">
          <span
            className="text-sm text-gray-700 tracking-[0.15em] font-mono select-none"
            style={{ letterSpacing: visible ? "0.05em" : "0.15em" }}
          >
            {displayCode}
          </span>
          <button
            onClick={() => setVisible((v) => !v)}
            className="ml-3 text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            aria-label={visible ? "Hide code" : "Show code"}
          >
            {visible ? (
              <EyeOff className="w-6 h-6" />
            ) : (
              <Eye className="w-6 h-6" />
            )}
          </button>
        </div>

        {/* Warning box */}
        <div className="flex items-start gap-3 bg-yellow-50 rounded-xl px-4 py-3.5 mb-6 border border-yellow-100">
          <ShieldAlert className="w-8 h-8 text-yellow-500 mt-0.5" />
          <p className="text-xs text-yellow-700 leading-relaxed">
            This code is required to access this document.
            <br />
            Keep it secure and don't share it publicly.
          </p>
        </div>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="w-full flex items-center justify-center gap-2 py-3.5 size-14 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm rounded-xl transition-colors"
        >
          <Copy className="w-4 h-4" />
          {copied ? "Copied!" : "Copy code"}
        </button>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { useApp } from "../store/AppContext";
import { DrmUnlockError, isAccessRevokedError } from "../services/drmService";
import { useAuth } from "../store/authContext";
import { featureFlags } from "../config/featureFlags";

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
  const { expireSession } = useAuth();
  // Email-code step (403 EMAIL_OTP_REQUIRED): null = not needed.
  const [otpEmail, setOtpEmail] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [otpInfo, setOtpInfo] = useState('');

  const doc = modal.documentId ? getDocumentById(modal.documentId) : null;
  const docName = doc?.displayName ?? 'Document';
  // True when the code was filled in from a previous successful open.
  const [isPrefilled, setIsPrefilled] = useState(false);

  const docId = doc?.id;
  const docRealId = doc?.realDocId;
  const docAccessCode = doc?.accessCode;
  const isProtected = Boolean(doc?.cdcContainer);

  // Documents opened before: fill in the access code saved (encrypted) at that time.
  useEffect(() => {
    if (!docId || !isProtected) return;
    let cancelled = false;

    async function loadSavedCode() {
      let saved: string | null = null;
      try {
        const realId = docRealId ?? (await window.drmApi?.getSecureData(docId!, 'realDocId'));
        if (realId) saved = await window.drmApi?.getSecureData(realId, 'passKey');
      } catch (err) {
        console.debug('Could not read saved access code', err);
      }
      // After a successful open the code is also kept on the document itself.
      if (!saved && docRealId && docAccessCode) saved = docAccessCode;
      if (!cancelled && saved) {
        const savedCode = saved;
        setCode((current) => current || savedCode);
        setIsPrefilled(true);
      }
    }

    void loadSavedCode();
    return () => {
      cancelled = true;
    };
  }, [docId, docRealId, docAccessCode, isProtected]);

  async function handleVerify(otpCode?: string) {
    if (!code.trim()) {
      setError('Please enter an access code');
      return;
    }
    if (otpCode !== undefined && !/^\d{5}$/.test(otpCode.trim())) {
      setError('Enter the 5-digit code from the email');
      return;
    }
    if (!doc) {
      setError('Document not found because it was deleted by the owner');
      return;
    }

    setIsVerifying(true);
    setError('');

    try {
      if (doc.isLocked && doc.cdcContainer) {
        // DRM flow: Activate and Decrypt
        await unlockDocument(doc.id, code.trim(), otpCode ? { otp: otpCode.trim() } : undefined);
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
      if (err instanceof DrmUnlockError) {
        if (err.kind === 'email_otp_required') {
          // A fresh 5-digit code was emailed (also how "Resend code" works).
          setOtpEmail(err.email ?? '');
          setOtp('');
          setOtpInfo(otpEmail !== null ? 'A new code has been sent.' : '');
          return;
        }
        if ((err.kind === 'auth_required' || err.kind === 'session_expired') && featureFlags.authPreview) {
          // Show sign-in; this modal reappears afterwards so the user can retry.
          expireSession(err.kind === 'auth_required' ? 'Sign in to ConfiShare to open this document.' : undefined);
          return;
        }
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

  if (otpEmail !== null) {
    return (
      <Modal onClose={closeModal}>
        <div className="px-7 py-6">
          <h2 className="text-[1.125rem] font-semibold text-gray-900 mb-5 pr-8">
            Confirm your email
          </h2>
          <hr className="text-gray-300 mb-5" />

          <p className="text-sm text-gray-500 leading-relaxed mb-4">
            Enter the 5-digit code we emailed to{" "}
            <span className="font-semibold text-gray-900">{otpEmail || "your email"}</span> to open{" "}
            <span className="font-semibold text-gray-900">{docName}</span>. The code expires in 10 minutes.
          </p>
          {otpInfo && <p className="text-xs text-[#059669] mb-3">{otpInfo}</p>}

          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={5}
            placeholder="5-digit code"
            value={otp}
            autoFocus
            onChange={(e) => {
              setOtp(e.target.value.replace(/\D/g, ""));
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleVerify(otp);
            }}
            style={{ padding: "1rem" }}
            className={`w-full text-sm text-gray-700 rounded-xl size-12 placeholder-gray-400 outline-none border pb-3 mb-4 transition-colors ${
              error ? "border-red-400" : "border-gray-200 focus:border-[#059669]"
            }`}
          />
          {error && <p className="text-xs text-red-500 mb-3 -mt-2">{error}</p>}

          <button
            onClick={() => handleVerify(otp)}
            disabled={isVerifying}
            className="w-full flex items-center justify-center gap-2 py-3.5 size-14 bg-[#059669] hover:bg-green-700 active:bg-green-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-colors"
          >
            {isVerifying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying...
              </>
            ) : (
              "Confirm & View Document"
            )}
          </button>
          <button
            onClick={() => handleVerify()}
            disabled={isVerifying}
            className="w-full mt-3 text-sm font-medium text-gray-500 hover:text-gray-700 cursor-pointer disabled:opacity-60 transition-colors"
          >
            Resend code
          </button>
        </div>
      </Modal>
    );
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
            setIsPrefilled(false);
          }}
          onKeyDown={handleKeyDown}
          autoFocus
          style={{padding:"1rem"}}
          className={`w-full text-sm text-gray-700 rounded-xl size-12 placeholder-gray-400 outline-none border pb-3 mb-4 transition-colors ${
            error ? "border-red-400" : "border-gray-200 focus:border-[#059669]"
          }`}
        />

        {/* Saved code notice */}
        {isPrefilled && !error && (
          <p className="text-xs text-[#059669] mb-3 -mt-2">
            Saved access code filled in from the last time you opened this document.
          </p>
        )}

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
          onClick={() => handleVerify()}
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

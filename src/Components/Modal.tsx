import React, { useEffect } from "react";
import { X } from "lucide-react";

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  showClose?: boolean;
  size?: "sm" | "md";
}

export function Modal({
  onClose,
  children,
  showClose = true,
  size = "md",
}: ModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const widthClass = size === "sm" ? "max-w-[420px]" : "max-w-[480px]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className={`relative bg-white rounded-2xl shadow-2xl w-full mx-4 p-4 ${widthClass} overflow-hidden`}
        style={{padding: "2rem"}}
        onClick={(e) => e.stopPropagation()}
      >
        {showClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 cursor-pointer z-10 w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 transition-colors text-gray-500"
          >
            <X className="w-6 h-6" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

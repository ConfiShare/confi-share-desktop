import { Plus } from "lucide-react";
import { useApp } from "../store/AppContext";

export function MainContent() {
  const { openModal } = useApp();

  return (
    <main className="flex-1 flex flex-col items-center justify-center bg-gray-50 h-full">
      {/* Document with plus icon */}
      <div className="mb-5 relative">
        <svg
          width="80"
          height="80"
          viewBox="0 0 80 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Document body */}
          <rect x="10" y="8" width="48" height="58" rx="5" fill="#e5e7eb" />
          {/* Folded corner */}
          <path d="M42 8 L58 24 L42 24 Z" fill="#d1d5db" />
          {/* Lines */}
          <rect x="18" y="34" width="28" height="3" rx="1.5" fill="#9ca3af" />
          <rect x="18" y="42" width="20" height="3" rx="1.5" fill="#9ca3af" />
          {/* Green plus circle overlay */}
          <circle cx="54" cy="54" r="14" fill="#16a34a" />
          <path
            d="M54 48 L54 60 M48 54 L60 54"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <h2 className="text-xl font-bold text-gray-900 mb-2">No documents yet</h2>
      <p className="text-sm text-gray-400 text-center max-w-xs mb-7 leading-relaxed">
        Import a secure document to get started.
        <br />
        Your files stay protected, and access is always in your control.
      </p>

      <button
        onClick={() => openModal({ type: "import_choose" })}
        className="flex items-center gap-2 px-8 py-3.5 size-14 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
      >
        <Plus className="w-6 h-6" />
        Import document
      </button>
    </main>
  );
}

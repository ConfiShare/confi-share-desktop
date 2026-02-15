// import { Plus } from "lucide-react";

export function SelectDocumentPanel() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center bg-gray-50 h-full">
      <div className="mb-5">
        <svg
          width="80"
          height="80"
          viewBox="0 0 80 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="10" y="8" width="48" height="58" rx="5" fill="#e5e7eb" />
          <path d="M42 8 L58 24 L42 24 Z" fill="#d1d5db" />
          <rect x="18" y="34" width="28" height="3" rx="1.5" fill="#9ca3af" />
          <rect x="18" y="42" width="20" height="3" rx="1.5" fill="#9ca3af" />
          <circle cx="54" cy="54" r="14" fill="#16a34a" />
          <path
            d="M54 48 L54 60 M48 54 L60 54"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Select a document
      </h2>
      <p className="text-base text-gray-400 text-center max-w-xs leading-relaxed">
        Choose a document from the sidebar to view its contents.
      </p>
    </main>
  );
}

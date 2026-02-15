import { useState } from "react";
import { Search, Settings, Plus } from "lucide-react";
import { useApp } from "../store/AppContext";
import { DocumentListItem } from "./DocumentListItem";

export function Sidebar() {
  const { filteredDocuments, searchQuery, setSearchQuery, openModal } =
    useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function handleImport() {
    openModal({ type: "import_choose" });
  }

  return (
    <aside className="w-[23%] flex flex-col h-full bg-white border-r border-gray-100 px-6">
      {/* Logo */}
      <div className="px-5 pb-4">
        <a href="/" className="" aria-disabled>
          <img src="/logo-dark.svg" alt="Logo Manin" width={150} height={80} />
        </a>
      </div>

      {/* Search */}
      <div className="px-4 pb-6 pt-6">
        <div
          className={`flex items-center gap-2 px-3 py-6 size-20 w-full rounded-xl border transition-colors ${
            searchQuery
              ? "border-[#059669] bg-white"
              : "border-none bg-gray-50 py-8"
          }`}
        >
          <Search className="w-6 h-6 text-gray-400 pl-6" />
          <input
            type="text"
            placeholder="Search documents"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-md text-gray-700 placeholder-gray-400 outline-none"
          />
        </div>
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-y-auto px-3 py-1">
        {filteredDocuments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium text-gray-700">
              {searchQuery ? "No documents found" : "No documents yet"}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {searchQuery
                ? "Try a different search term"
                : "Imported documents will appear here"}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredDocuments.map((doc) => (
                <DocumentListItem
                  key={doc.id}
                  doc={doc}
                  isSelected={selectedId === doc.id}
                  onSelect={() => setSelectedId(doc.id)}
                />
            ))}
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="px-4 pb-5 border-t border-gray-100 space-y-2">
        <button
          onClick={handleImport}
          className="w-full flex cursor-pointer items-center justify-center gap-2 py-8 px-6 size-14 bg-[#059669] hover:bg-green-700 active:bg-[#059669] text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
        >
          <Plus className="w-6 h-6" />
          Import document
        </button>
        <button className="w-full cursor-pointer flex items-center gap-2 mb-4 px-6 text-gray-800 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-colors text-base font-medium">
          <Settings className="w-6 h-6" />
          Settings
        </button>
      </div>
    </aside>
  );
}

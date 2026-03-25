import { useState, useRef, useEffect } from 'react';
import { FileText, MoreVertical, Key, Eye } from 'lucide-react';
import type { ConfiDocument } from '../types';
import { StatusBadge } from './StatusBadge';
import { formatExpiry, useApp } from '../store/AppContext';

interface DocumentListItemProps {
  doc: ConfiDocument;
  isSelected: boolean;
  onSelect: () => void;
}

export function DocumentListItem({
  doc,
  isSelected,
  onSelect,
}: DocumentListItemProps) {
  const { openModal } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      window.document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      window.document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  function handleMenuClick(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen((prev) => !prev);
  }

  function handleCopyAccessCode(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    openModal({ type: 'view_access_code', documentId: doc.id });
  }

  function handleViewDocument(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    if (doc.status === 'revoked') {
      openModal({ type: 'access_revoked', documentId: doc.id });
    } else {
      // Always require access code first — no bypass
      openModal({ type: 'enter_access_code', documentId: doc.id });
    }
  }

  return (
    <div
      onClick={onSelect}
      className={`relative flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-colors group ${
        isSelected ? 'bg-gray-50' : 'hover:bg-gray-50'
      }`}
    >
      {/* File icon */}
      <div className="shrink-0 w-9 h-9 bg-gray-50 rounded-lg flex items-center justify-center relative">
        <FileText className="w-6 h-6 text-gray-500" />
        {doc.isLocked && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 rounded-full flex items-center justify-center shadow-sm">
            <Key className="w-2.5 h-2.5 text-white" />
          </div>
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <StatusBadge status={doc.status} />
          {doc.realDocId && (
            <span className="text-[11px] text-gray-400">{formatExpiry(doc.expiresAt)}</span>
          )}
        </div>
      </div>

      {/* 3-dot menu button */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={handleMenuClick}
          className="w-8 h-8 flex items-center justify-center rounded-lg group-hover:opacity-100 transition-opacity hover:bg-gray-200"
        >
          <MoreVertical className="w-6 h-6 text-gray-500" />
        </button>

        {/* Dropdown menu */}
        {menuOpen && (
          <div className="absolute right-0 top-9 z-50 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-1 overflow-hidden">
            {doc.accessCode && (
              <button
                onClick={handleCopyAccessCode}
                className="w-full flex cursor-pointer items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Key className="w-4 h-4 text-gray-500" />
                Copy access code
              </button>
            )}
            <button
              onClick={handleViewDocument}
              className="w-full flex cursor-pointer items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Eye className="w-4 h-4 text-gray-500" />
              View Document
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
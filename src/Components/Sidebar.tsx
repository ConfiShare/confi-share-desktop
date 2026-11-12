import { useState } from 'react';
import { Search, Plus, MoreHorizontal, /* Activity, */ LogOut } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useAuth } from '../store/authContext';
import { featureFlags } from '../config/featureFlags';
import { DocumentListItem } from './DocumentListItem';

/** "Ada Lovelace" → "AL"; falls back to the first letter of the email. */
function getInitials(fullName: string | undefined, email: string): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (email[0] ?? '?').toUpperCase();
}

export function Sidebar() {
  const { filteredDocuments, searchQuery, setSearchQuery, openModal, navigateTo, activeView } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { user, logout } = useAuth();

  function handleImport() {
    openModal({ type: 'import_choose' });
  }

  function handleSettings() {
    navigateTo('settings');
  }

  return (
    <aside className="w-[288px] shrink-0 flex flex-col h-full bg-white border-r border-gray-100">
      {/* Logo */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2">
     <a href="/">
       <img src='./logo-dark.svg' alt="Confi Share Logo" className="w-46" />
      </a>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div
          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors ${
            searchQuery ? 'border-[#059669] bg-white' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <Search className="w-6 h-6 text-gray-400 shrink-0" />
          <input
            type="text"
            placeholder="Search documents"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent size-10 text-sm text-gray-700 placeholder-gray-400 outline-none"
          />
        </div>
      </div>

      {/* Document list */}
      <div 
    style={{paddingTop:"1rem"}}
      className="emerald-scrollbar flex-1 overflow-y-auto px-3 py-12">
        {filteredDocuments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium text-gray-700">
              {searchQuery ? 'No documents found' : 'No documents yet'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {searchQuery ? 'Try a different search term' : 'Imported documents will appear here'}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredDocuments.map((doc) => (
              <DocumentListItem
                key={doc.id}
                doc={doc}
                isSelected={selectedId === doc.id}
                onSelect={() => {
                  setSelectedId(doc.id);
                  if (doc.status === 'revoked') {
                    openModal({ type: 'access_revoked', documentId: doc.id });
                  } else {
                    openModal({ type: 'enter_access_code', documentId: doc.id });
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div 
      style={{paddingBottom:"1rem"}}
      className="px-4 pb-12 pt-3 border-t border-gray-100 space-y-2">
        <button
          onClick={handleImport}
          className="w-full flex size-14 items-center cursor-pointer justify-center gap-2 py-3 px-4 bg-[#059669] hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
        >
          <Plus className="w-6 h-6" />
          Import document
        </button>
        {/* Shared file tracking is shown in the web app, not the desktop app.
        {featureFlags.trackingPreview && (
          <button
            onClick={() => navigateTo('tracking')}
            className={`w-full flex items-center gap-2 cursor-pointer py-2.5 px-3 rounded-xl transition-colors text-sm font-medium ${
              activeView === 'tracking'
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Activity className="w-6 h-6" />
            Shared file tracking
          </button>
        )}
        */}
        <button
          onClick={handleSettings}
          className={`w-full flex items-center gap-2 cursor-pointer py-2.5 px-3 rounded-xl transition-colors text-sm font-medium ${
            activeView === 'settings'
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <MoreHorizontal className="w-6 h-6" />
          About ConfiShare
        </button>
        {featureFlags.authPreview && user && (
          <div className="flex items-center gap-3 pt-3 mt-1 border-t border-gray-100 px-1">
            {/* Signed-in user: avatar with initials, name and email */}
            <div
              className="w-9 h-9 shrink-0 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-semibold"
              aria-hidden="true"
            >
              {getInitials(user.fullName, user.email)}
            </div>
            <div className="flex-1 min-w-0" title={`Signed in as ${user.email}`}>
              <p className="text-sm font-medium text-gray-900 truncate">{user.fullName || user.email}</p>
              {user.fullName && <p className="text-xs text-gray-500 truncate">{user.email}</p>}
            </div>
            <button
              onClick={() => {
                if (
                  !navigator.onLine &&
                  !window.confirm(
                    'You are offline. After signing out you will need an internet connection to sign in again and view your documents. Sign out anyway?'
                  )
                ) {
                  return;
                }
                navigateTo('home');
                void logout();
              }}
              title="Sign out"
              aria-label="Sign out"
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg cursor-pointer transition-colors text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

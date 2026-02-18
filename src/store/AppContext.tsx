import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ConfiDocument, ModalState, DocumentStatus } from '../types';

export type ActiveView = 'home' | 'document' | 'settings';

interface AppContextValue {
  documents: ConfiDocument[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filteredDocuments: ConfiDocument[];
  modal: ModalState;
  openModal: (state: ModalState) => void;
  closeModal: () => void;
  addDocument: (doc: ConfiDocument) => void;
  removeDocument: (id: string) => void;
  getDocumentById: (id: string) => ConfiDocument | undefined;
  activeView: ActiveView;
  activeDocumentId: string | null;
  navigateTo: (view: ActiveView, docId?: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// function generateCode(): string {
//   const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
//   let result = '';
//   for (let i = 0; i < 32; i++) {
//     result += chars.charAt(Math.floor(Math.random() * chars.length));
//   }
//   return result;
// }

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [documents, setDocuments] = useState<ConfiDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [modal, setModal] = useState<ModalState>({ type: null });
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);

  const filteredDocuments = searchQuery.trim()
    ? documents.filter((d) =>
        d.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : documents;

  const navigateTo = useCallback((view: ActiveView, docId?: string) => {
    setActiveView(view);
    setActiveDocumentId(docId ?? null);
  }, []);

  const openModal = useCallback((state: ModalState) => {
    setModal(state);
  }, []);

  const closeModal = useCallback(() => {
    setModal({ type: null });
  }, []);

  const addDocument = useCallback((doc: ConfiDocument) => {
    setDocuments((prev) => [...prev, doc]);
  }, []);

  const removeDocument = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const getDocumentById = useCallback(
    (id: string) => documents.find((d) => d.id === id),
    [documents]
  );

  return (
    <AppContext.Provider
      value={{
        documents,
        searchQuery,
        setSearchQuery,
        filteredDocuments,
        modal,
        openModal,
        closeModal,
        addDocument,
        removeDocument,
        getDocumentById,
        activeView,
        activeDocumentId,
        navigateTo,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function getStatusLabel(status: DocumentStatus): string {
  switch (status) {
    case 'active': return 'Active';
    case 'offline': return 'Offline';
    case 'code_expired': return 'Code Expired';
    case 'revoked': return 'Revoked';
    default: return status;
  }
}

export function formatExpiry(date: Date): string {
  const now = new Date();
  const isExpired = date < now;
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  const year = date.getFullYear();
  return `${isExpired ? 'Expired' : 'Expires'} ${month} ${day}, ${year}`;
}
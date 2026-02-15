import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ConfiDocument, ModalState, DocumentStatus } from '../types';

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
}

const AppContext = createContext<AppContextValue | null>(null);

function generateCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const MOCK_DOCUMENTS: ConfiDocument[] = [
  {
    id: '1',
    name: 'Financial_Report_Q4.2026.cdc',
    displayName: 'Q4 Financial Report',
    status: 'active',
    expiresAt: new Date('2026-01-12'),
    accessCode: generateCode(),
    sizeKb: 243,
  },
  {
    id: '2',
    name: 'Financial_Report_Q4.2026.cdc',
    displayName: 'Q4 Financial Report',
    status: 'offline',
    expiresAt: new Date('2026-01-12'),
    accessCode: generateCode(),
    sizeKb: 243,
  },
  {
    id: '3',
    name: 'Financial_Report_Q4.2026.cdc',
    displayName: 'Q4 Financial Report',
    status: 'revoked',
    expiresAt: new Date('2026-01-12'),
    accessCode: generateCode(),
    sizeKb: 243,
  },
];

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [documents, setDocuments] = useState<ConfiDocument[]>(MOCK_DOCUMENTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [modal, setModal] = useState<ModalState>({ type: null });

  const filteredDocuments = searchQuery.trim()
    ? documents.filter((d) =>
        d.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : documents;

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
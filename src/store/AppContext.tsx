import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ConfiDocument, ModalState, DocumentStatus } from '../types';
import { drmService } from '../services/drmService';

export type ActiveView = 'home' | 'document' | 'settings';

interface AppContextValue {
  documents: ConfiDocument[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filteredDocuments: ConfiDocument[];
  modal: ModalState;
  openModal: (state: ModalState) => void;
  closeModal: () => void;
  addDocument: (doc: ConfiDocument) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  getDocumentById: (id: string) => ConfiDocument | undefined;
  activeView: ActiveView;
  activeDocumentId: string | null;
  navigateTo: (view: ActiveView, docId?: string) => void;
  unlockDocument: (docId: string, passKey: string) => Promise<void>;
  markDocumentRevoked: (docId: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [documents, setDocuments] = useState<ConfiDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [modal, setModal] = useState<ModalState>({ type: null });
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);

  const isInitialized = useRef(false);

  // Load documents from disk on mount
  useEffect(() => {
    if (isInitialized.current) return;
    isInitialized.current = true;

    async function loadDocs() {
      if (window.drmApi) {
        const storedDocs = await window.drmApi.loadList();
        // Reset transient fields
        const hydrated = storedDocs.map((d) => {
          const doc = d as Partial<ConfiDocument> & { expiresAt?: string | Date };
          return {
            ...doc,
            fileObject: undefined,
            fileUrl: undefined,
            isLocked: true, // Always start locked as per user request
            expiresAt: doc.expiresAt ? new Date(doc.expiresAt) : new Date(),
          } as ConfiDocument;
        });
        setDocuments(hydrated);
      }
    }
    loadDocs();
  }, []);

  // Save documents to disk whenever they change
  useEffect(() => {
    if (window.drmApi && documents.length > 0) {
      // We don't save fileUrl or fileObject to the json
      const toSave = documents.map((doc) => {
        const serializableDoc = { ...doc };
        delete serializableDoc.fileUrl;
        delete serializableDoc.fileObject;
        return serializableDoc;
      });
      window.drmApi.saveList(toSave);
    }
  }, [documents]);

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

  const addDocument = useCallback(async (doc: ConfiDocument) => {
    const finalDoc = { ...doc };
    
    // If it has a fileObject, save it locally
    if (doc.fileObject && window.drmApi) {
      try {
        const buffer = await doc.fileObject.arrayBuffer();
        const localPath = await window.drmApi.saveFileLocally(doc.id, doc.name, buffer);
        finalDoc.localPath = localPath;
      } catch (e) {
        console.error('Failed to save file locally:', e);
      }
    }

    setDocuments((prev) => {
      const newList = [...prev, finalDoc];
      return newList;
    });
  }, []);

  const removeDocument = useCallback(async (id: string) => {
    setDocuments((prev) => {
      const newList = prev.filter((d) => d.id !== id);
      if (window.drmApi) {
        const toSave = newList.map((doc) => {
          const serializableDoc = { ...doc };
          delete serializableDoc.fileUrl;
          delete serializableDoc.fileObject;
          return serializableDoc;
        });
        window.drmApi.saveList(toSave);
      }
      return newList;
    });
    // Optional: Remove local file from disk too via IPC
  }, []);

  const markDocumentRevoked = useCallback((docId: string) => {
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === docId
          ? {
              ...doc,
              status: 'revoked',
              isLocked: true,
              fileUrl: undefined,
            }
          : doc
      )
    );
  }, []);

  const getDocumentById = useCallback(
    (id: string) => documents.find((d) => d.id === id),
    [documents]
  );

  const unlockDocument = useCallback(async (docId: string, passKey: string) => {
    const doc = getDocumentById(docId);
    if (!doc || !doc.cdcContainer) throw new Error('Document not found or not a protected file');

    try {
      const { decryptedData, realDocId, offlineExpiresAt } = await drmService.unlockDocument(docId, doc.cdcContainer, passKey);
      
      // decryptedData.file is base64
      const byteCharacters = atob(decryptedData.file);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: doc.cdcContainer.meta.mime });
      const fileUrl = URL.createObjectURL(blob);

      setDocuments(prev => prev.map(d => 
        d.id === docId ? { 
          ...d, 
          fileUrl, 
          realDocId, 
          isLocked: false,
          accessCode: passKey, // Store the access code for "View Access Code" section
          expiresAt: offlineExpiresAt ? new Date(offlineExpiresAt) : d.expiresAt
        } : d
      ));
    } catch (error) {
      console.error('Failed to unlock document:', error);
      throw error;
    }
  }, [getDocumentById]);

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
        unlockDocument,
        markDocumentRevoked,
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

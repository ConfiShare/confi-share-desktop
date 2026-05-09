import { AppProvider, useApp } from './store/AppContext';
import { Sidebar } from './Components/Sidebar';
import { MainContent } from './Components/Maincontent';
import { SelectDocumentPanel } from './Components/Selectdocumentpanel';
import { ModalManager } from './Components/Modalmanager';
import { DocumentViewer } from './Components/DocumentViewer';
import { SettingsPage } from './Components/SettingsPage';


function AppShell() {
  const { documents, activeView, activeDocumentId, navigateTo, getDocumentById } = useApp();
  const hasDocuments = documents.length > 0;

  function renderMain() {
    if (activeView === 'settings') {
      return <SettingsPage onBack={() => navigateTo('home')} />;
    }
    if (activeView === 'document' && activeDocumentId) {
      const doc = getDocumentById(activeDocumentId);
      if (doc) return <DocumentViewer doc={doc} />;
    }
    // default home
    return hasDocuments ? <SelectDocumentPanel /> : <MainContent />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">
      <Sidebar />
      {renderMain()}
      <ModalManager />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
import { AppProvider, useApp } from './store/AppContext';
import { Sidebar } from '../src/Components/Sidebar';
import { MainContent } from '../src/Components/Maincontent';
import { SelectDocumentPanel } from '../src/Components/Selectdocumentpanel';
import { ModalManager } from '../src/Components/Modalmanager';


function AppShell() {
  const { documents } = useApp();
  const hasDocuments = documents.length > 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">
      <Sidebar />
      {hasDocuments ? <SelectDocumentPanel /> : <MainContent />}
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
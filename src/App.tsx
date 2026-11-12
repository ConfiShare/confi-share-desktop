import { AppProvider, useApp } from './store/AppContext';
import { Sidebar } from './Components/Sidebar';
import { MainContent } from './Components/Maincontent';
import { SelectDocumentPanel } from './Components/Selectdocumentpanel';
import { ModalManager } from './Components/Modalmanager';
import { DocumentViewer } from './Components/DocumentViewer';
import { SettingsPage } from './Components/SettingsPage';
// import { SharedFilesTrackingPage } from './Components/tracking/SharedFilesTrackingPage';
import { AuthScreens } from './Components/auth/AuthScreens';
import { AuthProvider } from './store/AuthProvider';
import { useAuth } from './store/authContext';
import { featureFlags } from './config/featureFlags';
import { Loader2 } from 'lucide-react';


function AppShell() {
  const { documents, activeView, activeDocumentId, navigateTo, getDocumentById } = useApp();
  const hasDocuments = documents.length > 0;

  function renderMain() {
    if (activeView === 'settings') {
      return <SettingsPage onBack={() => navigateTo('home')} />;
    }
    // Shared file tracking is shown in the web app, not the desktop app.
    // if (activeView === 'tracking' && featureFlags.trackingPreview) {
    //   return <SharedFilesTrackingPage onBack={() => navigateTo('home')} />;
    // }
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

/**
 * Shows the auth screens before the app while the auth UI preview is enabled
 * (on by default; see config/featureFlags.ts). With the flag off the
 * app behaves exactly as before: straight into the document viewer.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isRestoring } = useAuth();
  if (featureFlags.authPreview && isRestoring) {
    // Restoring a saved sign-in from the secure store (works offline).
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }
  if (featureFlags.authPreview && !user) return <AuthScreens />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AppProvider>
      <AuthProvider>
        <AuthGate>
          <AppShell />
        </AuthGate>
      </AuthProvider>
    </AppProvider>
  );
}
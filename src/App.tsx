import { useEffect } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { StoreProvider, useStore } from "./context/StoreContext";
import { initTheme } from "./theme";
import { Sidebar } from "./components/Sidebar";
import { AuthView } from "./views/AuthView";
import { ProjectsView } from "./views/ProjectsView";
import { HomeView } from "./views/HomeView";
import { UsersView } from "./views/UsersView";
import { CasesView } from "./views/CasesView";
import { DocumentsView } from "./views/DocumentsView";
import { CodebookView } from "./views/CodebookView";
import { CodeTextView } from "./views/CodeTextView";
import { MemosView } from "./views/MemosView";
import { CodeReportsView } from "./views/CodeReportsView";
import { AIAssistView } from "./views/AIAssistView";
import { UserSettingsView } from "./views/UserSettingsView";
import { AppSettingsView } from "./views/AppSettingsView";
import "./App.css";

function AppShell() {
  const { view } = useStore();

  useEffect(() => { initTheme(); }, []);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
{view === "projects"      && <ProjectsView />}
        {view === "home"          && <HomeView />}
        {view === "users"         && <UsersView />}
        {view === "cases"         && <CasesView />}
        {view === "documents"     && <DocumentsView />}
        {view === "codebook"      && <CodebookView />}
        {view === "code-text"     && <CodeTextView />}
        {view === "memos"         && <MemosView />}
        {view === "ai-assist"     && <AIAssistView />}
        {view === "code-reports"  && <CodeReportsView />}
        {view === "user-settings" && <UserSettingsView />}
        {view === "app-settings"  && <AppSettingsView />}
      </main>
    </div>
  );
}

function AuthGate() {
  const { status, pb } = useAuth();

  if (status !== "authenticated" || !pb) {
    return <AuthView />;
  }

  return (
    <StoreProvider pb={pb}>
      <AppShell />
    </StoreProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

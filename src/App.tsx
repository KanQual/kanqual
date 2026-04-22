import { useEffect } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { StoreProvider, useStore } from "./context/StoreContext";
import { initTheme } from "./theme";
import { Sidebar } from "./components/Sidebar";
import { AuthView } from "./views/Auth_View";
import { ProjectsView } from "./views/Projects_View";
import { HomeView } from "./views/Project_Home_View";
import { UsersView } from "./views/Project_Users_View";
import { CasesView } from "./views/Project_Cases_View";
import { DocumentsView } from "./views/Project_Documents_View";
import { CodebookView } from "./views/Project_Codebook_View";
import { CodeTextView } from "./views/Analysis_CodeText_View";
import { MemosView } from "./views/Analysis_Memos_View";
import { CodeReportsView } from "./views/Reports_Annotations_View";
import { AIAssistView } from "./views/Analysis_AIAssist_View";
import { UserSettingsView } from "./views/User_Settings_View";
import { AppSettingsView } from "./views/App_Settings_View";
import { ProjectLogView } from "./views/Project_ProjectLog_View";
import { ProjectSettingsView } from "./views/Project_Settings_View";
import { CodersView } from "./views/Reports_Coders_View";
import { CodesView } from "./views/Reports_Codes_View";
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
        {view === "project-settings" && <ProjectSettingsView />}
        {view === "code-text"     && <CodeTextView />}
        {view === "memos"         && <MemosView />}
        {view === "ai-assist"     && <AIAssistView />}
        {view === "code-reports"  && <CodeReportsView />}
        {view === "codes"         && <CodesView />}
        {view === "coders"        && <CodersView />}
        {view === "project-log"   && <ProjectLogView />}
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

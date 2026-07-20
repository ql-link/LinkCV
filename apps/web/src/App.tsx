import { useEffect } from "react";
import { Header } from "./components/Header";
import { SplitPane } from "./components/SplitPane";
import { AuthPage } from "./features/auth/AuthPage";
import { EditorPanel } from "./features/editor/EditorPanel";
import { HomePage } from "./features/home/HomePage";
import { PreviewPanel } from "./features/preview/PreviewPanel";
import { useResumeStore } from "./store/resumeStore";

export function App() {
  const authStatus = useResumeStore((state) => state.authStatus);
  const activeResumeId = useResumeStore((state) => state.activeResumeId);
  const hydrate = useResumeStore((state) => state.hydrate);
  const dirty = useResumeStore((state) => state.dirty);
  const editVersion = useResumeStore((state) => state.editVersion);
  const saveCurrentResume = useResumeStore((state) => state.saveCurrentResume);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!dirty || !activeResumeId) return;

    const timer = window.setTimeout(() => {
      void saveCurrentResume();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [activeResumeId, dirty, editVersion, saveCurrentResume]);

  if (authStatus === "checking") {
    return <div className="app-loading">正在加载简历工作台...</div>;
  }

  if (authStatus === "guest") {
    return <AuthPage />;
  }

  if (!activeResumeId) {
    return <HomePage />;
  }

  return (
    <div className="app-shell">
      <Header />
      <SplitPane left={<EditorPanel />} right={<PreviewPanel />} />
    </div>
  );
}

import { useEffect, useLayoutEffect, useState } from "react";
import { AuthPage } from "./features/auth/AuthPage";
import { HomePage } from "./features/home/HomePage";
import { LandingPage } from "./features/landing/LandingPage";
import { ResumeWorkbench } from "./features/workbench/ResumeWorkbench";
import { useResumeStore } from "./store/resumeStore";

export function App() {
  const [guestView, setGuestView] = useState<"landing" | "auth">("landing");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const authStatus = useResumeStore((state) => state.authStatus);
  const activeResumeId = useResumeStore((state) => state.activeResumeId);
  const hydrate = useResumeStore((state) => state.hydrate);
  const dirty = useResumeStore((state) => state.dirty);
  const editVersion = useResumeStore((state) => state.editVersion);
  const saveCurrentResume = useResumeStore((state) => state.saveCurrentResume);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useLayoutEffect(() => {
    if (authStatus === "guest") {
      setGuestView("landing");
    }
  }, [authStatus]);

  useEffect(() => {
    if (!dirty || !activeResumeId) return;

    const timer = window.setTimeout(() => {
      void saveCurrentResume();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [activeResumeId, dirty, editVersion, saveCurrentResume]);

  if (authStatus === "checking") {
    return <div className="app-loading">正在加载简历工作台...</div>;
  }

  if (authStatus === "guest") {
    if (guestView === "auth") {
      return <AuthPage initialMode={authMode} />;
    }

    return (
      <LandingPage
        onLogin={() => {
          setAuthMode("login");
          setGuestView("auth");
        }}
        onStart={() => {
          setAuthMode("register");
          setGuestView("auth");
        }}
      />
    );
  }

  if (!activeResumeId) {
    return <HomePage />;
  }

  return <ResumeWorkbench />;
}

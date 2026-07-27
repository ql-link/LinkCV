import { useEffect, useState } from "react";
import { Button } from "./components/ds";
import { AdminApp } from "./features/admin/AdminApp";
import { AuthPage } from "./features/auth/AuthPage";
import { HomePage } from "./features/home/HomePage";
import { LandingPage } from "./features/landing/LandingPage";
import { ResumeWorkbench } from "./features/workbench/ResumeWorkbench";
import { authPath, editorPath, navigateTo, useAppRoute } from "./routing";
import { useResumeStore } from "./store/resumeStore";

export function App() {
  const route = useAppRoute();
  const routeResumeId = route.kind === "editor" ? route.resumeId : null;
  const [routeError, setRouteError] = useState<{ resumeId: string; message: string } | null>(null);
  const authStatus = useResumeStore((state) => state.authStatus);
  const activeResumeId = useResumeStore((state) => state.activeResumeId);
  const hydrate = useResumeStore((state) => state.hydrate);
  const loadResume = useResumeStore((state) => state.loadResume);
  const goHome = useResumeStore((state) => state.goHome);
  const dirty = useResumeStore((state) => state.dirty);
  const editVersion = useResumeStore((state) => state.editVersion);
  const saveCurrentResume = useResumeStore((state) => state.saveCurrentResume);

  useEffect(() => {
    if (route.kind === "admin") return;
    void hydrate();
  }, [hydrate, route.kind]);

  useEffect(() => {
    if (route.kind === "admin") return;
    if (!dirty || !activeResumeId) return;

    const timer = window.setTimeout(() => {
      void saveCurrentResume();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [activeResumeId, dirty, editVersion, route.kind, saveCurrentResume]);

  useEffect(() => {
    if (route.kind === "admin") return;
    if (authStatus === "checking") return;

    if (authStatus === "guest") {
      if (route.kind === "resumes" || route.kind === "editor") {
        const next = `${window.location.pathname}${window.location.search}`;
        navigateTo(authPath("login", next), { replace: true });
      } else if (route.kind === "notFound") {
        navigateTo("/", { replace: true });
      }
      return;
    }

    if (route.kind === "landing" || route.kind === "auth") {
      navigateTo("/resumes", { replace: true });
    }
  }, [authStatus, route.kind]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !routeResumeId) return;
    if (activeResumeId === routeResumeId) {
      setRouteError(null);
      return;
    }

    let cancelled = false;
    setRouteError(null);
    void (async () => {
      if (dirty && activeResumeId) {
        await saveCurrentResume();
        if (useResumeStore.getState().error) {
          throw new Error("当前简历保存失败，尚未切换。");
        }
      }
      try {
        await loadResume(routeResumeId);
      } catch {
        if (!cancelled) {
          setRouteError({ resumeId: routeResumeId, message: "简历不存在，或当前账号没有访问权限。" });
        }
      }
    })().catch((error) => {
      if (!cancelled) setRouteError({ resumeId: routeResumeId, message: (error as Error).message });
    });

    return () => {
      cancelled = true;
    };
  }, [activeResumeId, authStatus, dirty, loadResume, routeResumeId, saveCurrentResume]);

  useEffect(() => {
    if (authStatus !== "authenticated" || route.kind !== "resumes" || !activeResumeId) return;
    let cancelled = false;
    void (async () => {
      if (dirty) {
        await saveCurrentResume();
        if (useResumeStore.getState().error) {
          navigateTo(editorPath(activeResumeId), { replace: true });
          return;
        }
      }
      if (!cancelled) goHome();
    })();
    return () => {
      cancelled = true;
    };
  }, [activeResumeId, authStatus, dirty, goHome, route.kind, saveCurrentResume]);

  if (route.kind === "admin") {
    return <AdminApp />;
  }

  if (authStatus === "checking") {
    return <div className="app-loading">正在加载简历工作台...</div>;
  }

  if (authStatus === "guest") {
    if (route.kind === "auth") {
      return <AuthPage key={`${route.mode}:${route.next ?? ""}`} initialMode={route.mode} next={route.next} />;
    }

    return (
      <LandingPage
        onLogin={() => navigateTo(authPath("login"))}
        onStart={() => navigateTo(authPath("register"))}
      />
    );
  }

  if (route.kind === "resumes") {
    return <HomePage />;
  }

  if (route.kind === "editor") {
    if (routeError?.resumeId === route.resumeId) {
      return (
        <main className="route-error-page">
          <h1>无法打开这份简历</h1>
          <p>{routeError.message}</p>
          <Button onClick={() => navigateTo("/resumes", { replace: true })}>返回简历主页</Button>
        </main>
      );
    }
    if (activeResumeId !== route.resumeId) {
      return <div className="app-loading">正在打开简历...</div>;
    }
    return <ResumeWorkbench />;
  }

  if (route.kind === "notFound") {
    return (
      <main className="route-error-page">
        <h1>页面不存在</h1>
        <Button onClick={() => navigateTo("/resumes", { replace: true })}>返回简历主页</Button>
      </main>
    );
  }

  return <div className="app-loading">正在进入简历主页...</div>;
}

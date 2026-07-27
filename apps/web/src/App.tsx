import { useEffect, useState } from "react";
import { Button } from "./components/ds";
import { ApiRequestError } from "./api/client";
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
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!dirty || !activeResumeId) return;

    const timer = window.setTimeout(() => {
      void saveCurrentResume();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [activeResumeId, dirty, editVersion, saveCurrentResume]);

  useEffect(() => {
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
      } catch (error) {
        if (!cancelled) {
          setRouteError({ resumeId: routeResumeId, message: resumeLoadErrorMessage(error) });
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

export function resumeLoadErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 404) return "简历不存在，或当前账号没有访问权限。";
    if (error.status === 401) return "登录状态已失效，请重新登录后再试。";
    if (error.message === "RESUME_SCHEMA_INVALID") {
      return "这份简历的数据格式暂时无法读取，请先完成数据迁移。";
    }
    if (error.status >= 500) return "服务暂时无法读取这份简历，请稍后重试。";
  }
  return "无法连接到服务，请检查本地服务后重试。";
}

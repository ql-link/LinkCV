import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Brand, Button, PageLoading } from "@/components/ui";
import { WorkspaceLayout, type WorkspaceSection } from "./components/WorkspaceLayout";
import { ApiRequestError } from "./api/client";
import { AccountPage } from "./features/account/AccountPage";
import { AdminApp } from "./features/admin/AdminApp";
import { AdminLoginPage } from "./features/admin/AdminLoginPage";
import { AuthPage } from "./features/auth/AuthPage";
import { DatasetsPage } from "./features/datasets/DatasetsPage";
import { HomePage } from "./features/home/HomePage";
import { ResumeCreatePage } from "./features/home/ResumeCreatePage";
import { ResumeTemplatesPage } from "./features/templates/ResumeTemplatesPage";
import { JobCenterPage } from "./features/jobs/JobCenterPage";
import { JobDetailPage } from "./features/jobs/JobDetailPage";
import { JobFormPage } from "./features/jobs/JobFormPage";
import { LandingPage } from "./features/landing/LandingPage";
import { NotFoundPage } from "./features/not-found/NotFoundPage";
import { SharePage } from "./features/share/SharePage";
import { ResumeWorkbench } from "./features/workbench/ResumeWorkbench";
import { authPath, editorPath, navigateTo, useAppRoute } from "./routing";
import { useResumeStore } from "./store/resumeStore";

export function App() {
  const route = useAppRoute();
  const routeResumeId = route.kind === "editor" ? route.resumeId : null;
  const isAdminArea = route.kind === "admin" || route.kind === "adminLogin";
  const [routeError, setRouteError] = useState<{ resumeId: string; message: string } | null>(null);
  const authStatus = useResumeStore((state) => state.authStatus);
  const activeResumeId = useResumeStore((state) => state.activeResumeId);
  const hydrate = useResumeStore((state) => state.hydrate);
  const loadResume = useResumeStore((state) => state.loadResume);
  const goHome = useResumeStore((state) => state.goHome);
  const dirty = useResumeStore((state) => state.dirty);
  const versionOperationPending = useResumeStore((state) => state.versionOperationPending);
  const editVersion = useResumeStore((state) => state.editVersion);
  const saveCurrentResume = useResumeStore((state) => state.saveCurrentResume);

  useEffect(() => {
    if (isAdminArea) return;
    void hydrate();
  }, [hydrate, isAdminArea]);

  useEffect(() => {
    if (isAdminArea) return;
    if (!dirty || !activeResumeId || versionOperationPending) return;

    const timer = window.setTimeout(() => {
      void saveCurrentResume();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [activeResumeId, dirty, editVersion, isAdminArea, saveCurrentResume, versionOperationPending]);

  useEffect(() => {
    if (isAdminArea) return;
    if (authStatus === "checking") return;

    if (authStatus === "guest") {
      if (
        route.kind === "resumes"
        || route.kind === "templates"
        || route.kind === "resumeCreate"
        || route.kind === "editor"
        || route.kind === "jobs"
        || route.kind === "jobCreate"
        || route.kind === "jobDetail"
        || route.kind === "jobEdit"
        || route.kind === "datasets"
        || route.kind === "account"
      ) {
        const next = `${window.location.pathname}${window.location.search}`;
        navigateTo(authPath("login", next), { replace: true });
      }
      return;
    }

    if (route.kind === "auth") {
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

  if (route.kind === "admin") {
    return <AdminApp />;
  }

  if (route.kind === "adminLogin") {
    return <AdminLoginPage key={route.next ?? ""} next={route.next} />;
  }

  if (route.kind === "share") {
    return <SharePage token={route.token} />;
  }

  if (authStatus === "checking") {
    return <PageLoading label="正在加载简历工作台…" scope="page" />;
  }

  if (route.kind === "notFound") {
    return <NotFoundPage />;
  }

  if (route.kind === "landing") {
    const landingDestination = authStatus === "authenticated"
      ? "/resumes"
      : null;

    return (
      <LandingPage
        onLogin={() => navigateTo(landingDestination ?? authPath("login"))}
        onStart={() => navigateTo(landingDestination ?? authPath("register"))}
      />
    );
  }

  if (authStatus === "guest") {
    if (route.kind === "auth") {
      return <AuthPage key={`${route.mode}:${route.next ?? ""}`} initialMode={route.mode} next={route.next} />;
    }

    return <PageLoading label="正在进入首页…" scope="page" />;
  }

  if (route.kind === "resumeCreate") {
    return <ResumeCreatePage />;
  }

  if (
    route.kind === "resumes"
    || route.kind === "templates"
    || route.kind === "jobs"
    || route.kind === "jobCreate"
    || route.kind === "jobDetail"
    || route.kind === "jobEdit"
    || route.kind === "datasets"
    || route.kind === "account"
  ) {
    const activeSection: WorkspaceSection = route.kind === "resumes"
      ? "resumes"
      : route.kind === "templates"
        ? "templates"
      : route.kind === "account"
        ? "account"
        : route.kind === "datasets"
          ? "datasets"
          : "jobs";

    return (
      <WorkspaceLayout active={activeSection}>
        {route.kind === "resumes" && <HomePage />}
        {route.kind === "templates" && <ResumeTemplatesPage />}
        {route.kind === "jobs" && <JobCenterPage />}
        {route.kind === "jobCreate" && <JobFormPage mode="create" />}
        {route.kind === "jobDetail" && <JobDetailPage jobId={route.jobId} />}
        {route.kind === "jobEdit" && <JobFormPage mode="edit" jobId={route.jobId} />}
        {route.kind === "datasets" && <DatasetsPage />}
        {route.kind === "account" && <AccountPage />}
      </WorkspaceLayout>
    );
  }

  if (route.kind === "editor") {
    if (routeError?.resumeId === route.resumeId) {
      return (
        <StatusShell>
          <div className="status-card">
            <span className="status-icon" aria-hidden="true">
              <CircleAlert size={26} />
            </span>
            <h1>无法打开这份简历</h1>
            <p className="status-desc">{routeError.message}</p>
            <p className="status-desc">你可以返回主页选择其他简历，或稍后重试。</p>
            <div className="status-actions">
              <Button variant="outline" onClick={() => navigateTo("/resumes", { replace: true })}>
                返回主页
              </Button>
              <Button
                onClick={() => {
                  const resumeId = route.resumeId;
                  setRouteError(null);
                  void loadResume(resumeId).catch((error: unknown) => {
                    setRouteError({ resumeId, message: resumeLoadErrorMessage(error) });
                  });
                }}
              >
                重新尝试
              </Button>
            </div>
          </div>
        </StatusShell>
      );
    }
    if (activeResumeId !== route.resumeId) {
      return <StatusShell><PageLoading label="正在打开简历…" scope="panel" /></StatusShell>;
    }
    return <ResumeWorkbench />;
  }

  return <PageLoading label="正在进入简历主页…" scope="page" />;
}

function StatusShell({ children }: { children: ReactNode }) {
  return (
    <div className="status-shell">
      <header className="status-topbar">
        <a href="/" aria-label="返回 LinkCV 首页" className="status-brand">
          <Brand />
        </a>
      </header>
      <main className="status-body">{children}</main>
    </div>
  );
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

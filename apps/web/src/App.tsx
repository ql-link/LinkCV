import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Brand, Button, PageLoading } from "@/components/ui";
import { CareerNavigation, WorkspaceLayout, type CareerSection, type WorkspaceSection } from "./components/WorkspaceLayout";
import { ApiRequestError } from "./api/client";
import { authPath, editorPath, legacyCareerRedirect, navigateTo, useAppRoute } from "./routing";
import { useResumeStore } from "./store/resumeStore";
import {
  loadAccountPage,
  loadAssistantPage,
  loadDatasetsPage,
  loadHomePage,
  loadInterviewCenterPage,
  loadJobCenterPage,
  loadResumeTemplatesPage,
} from "./workspacePageLoaders";

const AccountPage = lazy(() => loadAccountPage().then((module) => ({ default: module.AccountPage })));
const AssistantPage = lazy(() => loadAssistantPage().then((module) => ({ default: module.AssistantPage })));
const AdminApp = lazy(() => import("./features/admin/AdminApp").then((module) => ({ default: module.AdminApp })));
const AdminLoginPage = lazy(() => import("./features/admin/AdminLoginPage").then((module) => ({ default: module.AdminLoginPage })));
const AuthPage = lazy(() => import("./features/auth/AuthPage").then((module) => ({ default: module.AuthPage })));
const DatasetsPage = lazy(() => loadDatasetsPage().then((module) => ({ default: module.DatasetsPage })));
const HomePage = lazy(() => loadHomePage().then((module) => ({ default: module.HomePage })));
const ResumeCreatePage = lazy(() => import("./features/home/ResumeCreatePage").then((module) => ({ default: module.ResumeCreatePage })));
const ResumeTemplatesPage = lazy(() => loadResumeTemplatesPage().then((module) => ({ default: module.ResumeTemplatesPage })));
const JobCenterPage = lazy(() => loadJobCenterPage().then((module) => ({ default: module.JobCenterPage })));
const JobDetailPage = lazy(() => import("./features/jobs/JobDetailPage").then((module) => ({ default: module.JobDetailPage })));
const JobFormPage = lazy(() => import("./features/jobs/JobFormPage").then((module) => ({ default: module.JobFormPage })));
const InterviewCenterPage = lazy(() => loadInterviewCenterPage().then((module) => ({ default: module.InterviewCenterPage })));
const LandingPage = lazy(() => import("./features/landing/LandingPage").then((module) => ({ default: module.LandingPage })));
const NotFoundPage = lazy(() => import("./features/not-found/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));
const SharePage = lazy(() => import("./features/share/SharePage").then((module) => ({ default: module.SharePage })));
const ResumeWorkbench = lazy(() => import("./features/workbench/ResumeWorkbench").then((module) => ({ default: module.ResumeWorkbench })));

export function App() {
  return (
    <Suspense fallback={<AppRouteLoadingFallback />}>
      <AppContent />
    </Suspense>
  );
}

export function AppRouteLoadingFallback() {
  const route = useAppRoute();
  const loading = <PageLoading label="正在加载页面…" scope="page" />;
  const usesLightWorkspace = route.kind === "resumes"
    || route.kind === "assistant"
    || route.kind === "templates"
    || route.kind === "resumeCreate"
    || route.kind === "editor"
    || route.kind === "jobs"
    || route.kind === "jobCreate"
    || route.kind === "jobDetail"
    || route.kind === "jobEdit"
    || route.kind === "interviews"
    || route.kind === "datasets"
    || route.kind === "account";
  return usesLightWorkspace ? <div data-ui-theme="light">{loading}</div> : loading;
}

export function WorkspacePageBoundary({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={(
      <main className="dashboard-content workspace-route-loading">
        <PageLoading label="正在加载模块…" scope="workspace" />
      </main>
    )}>
      {children}
    </Suspense>
  );
}

function AppContent() {
  const route = useAppRoute();
  const currentLocation = `${window.location.pathname}${window.location.search}`;
  const isInterviewMockPreview = import.meta.env.DEV
    && route.kind === "interviews"
    && new URLSearchParams(window.location.search).get("mock") === "1";
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
    if (isInterviewMockPreview) return;
    const redirect = legacyCareerRedirect(window.location.pathname, window.location.search);
    if (redirect) navigateTo(redirect, { replace: true });
  }, [currentLocation, isInterviewMockPreview]);

  useEffect(() => {
    if (isAdminArea || isInterviewMockPreview) return;
    void hydrate();
  }, [hydrate, isAdminArea, isInterviewMockPreview]);

  useEffect(() => {
    if (isAdminArea || isInterviewMockPreview) return;
    if (!dirty || !activeResumeId || versionOperationPending) return;

    const timer = window.setTimeout(() => {
      void saveCurrentResume();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [activeResumeId, dirty, editVersion, isAdminArea, isInterviewMockPreview, saveCurrentResume, versionOperationPending]);

  useEffect(() => {
    if (isAdminArea || isInterviewMockPreview) return;
    if (authStatus === "checking") return;

    if (authStatus === "guest") {
      if (
        route.kind === "resumes"
        || route.kind === "assistant"
        || route.kind === "templates"
        || route.kind === "resumeCreate"
        || route.kind === "editor"
        || route.kind === "jobs"
        || route.kind === "jobCreate"
        || route.kind === "jobDetail"
        || route.kind === "jobEdit"
        || route.kind === "interviews"
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
  }, [authStatus, isInterviewMockPreview, route.kind]);

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

  if (isInterviewMockPreview && route.kind === "interviews") {
    return (
      <WorkspaceLayout active="career">
        <WorkspacePageBoundary>
          <InterviewCenterPage
            view={route.view}
            navigation={<CareerNavigation active={route.view === "records" ? "reviews" : route.view} />}
          />
        </WorkspacePageBoundary>
      </WorkspaceLayout>
    );
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

  if (route.kind === "assistant") {
    return (
      <WorkspaceLayout active="assistant" className="assistant-workspace-shell">
        <WorkspacePageBoundary>
          <AssistantPage />
        </WorkspacePageBoundary>
      </WorkspaceLayout>
    );
  }

  if (
    route.kind === "resumes"
    || route.kind === "templates"
    || route.kind === "jobs"
    || route.kind === "jobCreate"
    || route.kind === "jobDetail"
    || route.kind === "jobEdit"
    || route.kind === "interviews"
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
          : "career";

    const careerSection: CareerSection | null = route.kind === "jobs"
      || route.kind === "jobCreate"
      || route.kind === "jobDetail"
      || route.kind === "jobEdit"
      ? "jobs"
      : route.kind === "interviews"
        ? route.view === "records" ? "reviews" : route.view
        : null;

    return (
      <WorkspaceLayout active={activeSection}>
        <WorkspacePageBoundary>
          {careerSection && route.kind !== "interviews" && route.kind !== "jobs" && route.kind !== "jobCreate" && <CareerNavigation active={careerSection} />}
          {route.kind === "resumes" && <HomePage />}
          {route.kind === "templates" && <ResumeTemplatesPage />}
          {(route.kind === "jobs" || route.kind === "jobCreate") && (
            <JobCenterPage
              createDialogOpen={route.kind === "jobCreate"}
              navigation={<CareerNavigation active="jobs" />}
            />
          )}
          {route.kind === "jobDetail" && <JobDetailPage jobId={route.jobId} />}
          {route.kind === "jobEdit" && <JobFormPage mode="edit" jobId={route.jobId} />}
          {route.kind === "interviews" && (
            <InterviewCenterPage
              view={route.view}
              initialApplicationId={route.applicationId}
              initialSessionId={route.sessionId}
              initialJobId={route.jobId}
              initialCreateApplication={route.createApplication}
              navigation={<CareerNavigation active={careerSection ?? "applications"} />}
            />
          )}
          {route.kind === "datasets" && <DatasetsPage />}
          {route.kind === "account" && <AccountPage />}
        </WorkspacePageBoundary>
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

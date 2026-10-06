import { lazy, Suspense, useDeferredValue, useEffect, useState, type ReactNode } from "react";
import { PageLoading } from "@/components/ui";
import { EditorOpenError } from "./features/workbench/EditorOpenError";
import { V3Shell, type V3Section } from "./v3/Shell";
import { RouteSkeleton } from "./v3/skeletons";
import { getLocaleRevision, setLocale, t, useLocale } from "./i18n";
import { api, ApiRequestError } from "./api/client";
import { authPath, editorPath, legacyCareerRedirect, navigateTo, useAppRoute } from "./routing";
import { applyRouteSeo } from "./seo";
import { useResumeStore } from "./store/resumeStore";
import {
  loadAccountPage,
  loadAssistantPage,
  loadDatasetsPage,
  loadHomePage,
  loadInterviewCenterPage,
  loadMockInterviewPage,
  loadResumeTemplatesPage,
  scheduleAuthenticatedWorkspacePreload,
} from "./workspacePageLoaders";

export const RESUME_AUTOSAVE_INTERVAL_MS = 10_000;

export function startResumeAutosave(save: () => void) {
  return window.setInterval(save, RESUME_AUTOSAVE_INTERVAL_MS);
}

const AccountDeletionPage = lazy(() => import("./features/account/AccountDeletionPage").then((module) => ({ default: module.AccountDeletionPage })));
const AccountPage = lazy(() => loadAccountPage().then((module) => ({ default: module.AccountPage })));
const AssistantPage = lazy(() => loadAssistantPage().then((module) => ({ default: module.AssistantPage })));
const AdminApp = lazy(() => import("./features/admin/AdminApp").then((module) => ({ default: module.AdminApp })));
const AdminLoginPage = lazy(() => import("./features/admin/AdminLoginPage").then((module) => ({ default: module.AdminLoginPage })));
const AuthPage = lazy(() => import("./features/auth/AuthPage").then((module) => ({ default: module.AuthPage })));
const DatasetsPage = lazy(() => loadDatasetsPage().then((module) => ({ default: module.DatasetsPage })));
const HomePage = lazy(() => loadHomePage().then((module) => ({ default: module.HomePage })));
const ResumeCreatePage = lazy(() => import("./features/home/ResumeCreatePage").then((module) => ({ default: module.ResumeCreatePage })));
const MockInterviewPage = lazy(() => loadMockInterviewPage().then((module) => ({ default: module.MockInterviewPage })));
const ResumeTemplatesPage = lazy(() => loadResumeTemplatesPage().then((module) => ({ default: module.ResumeTemplatesPage })));
const JobDetailPage = lazy(() => import("./features/jobs/JobDetailPage").then((module) => ({ default: module.JobDetailPage })));
const InterviewCenterPage = lazy(() => loadInterviewCenterPage().then((module) => ({ default: module.InterviewCenterPage })));
const loadLandingPage = () => import("./features/landing/LandingPage");
const LandingPage = lazy(() => loadLandingPage().then((module) => ({ default: module.LandingPage })));
const NotFoundPage = lazy(() => import("./features/not-found/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));
const InAppNotFound = lazy(() => import("./features/not-found/NotFoundPage").then((module) => ({ default: module.InAppNotFound })));
const SharePage = lazy(() => import("./features/share/SharePage").then((module) => ({ default: module.SharePage })));
const ResumeWorkbench = lazy(() => import("./features/workbench/ResumeWorkbench").then((module) => ({ default: module.ResumeWorkbench })));

export function App() {
  useLocale();
  return (
    <Suspense fallback={<AppRouteLoadingFallback />}>
      <AppContent />
    </Suspense>
  );
}

/** 落地页加载占位不渲染可见中文：可见中文会让全站字体栈提前下载 13.8MB 的整包思源黑体。 */
function LandingLoading() {
  return <div role="status" aria-label={t("正在加载页面…")} style={{ minHeight: "100vh", background: "#fcfcfc" }} />;
}

export function AppRouteLoadingFallback() {
  const locale = useLocale();
  const route = useAppRoute();
  if (route.kind === "landing") return <LandingLoading />;
  const loading = <PageLoading label={t("正在加载页面…")} scope="page" />;
  const usesLightWorkspace = route.kind === "resumes"
    || route.kind === "assistant"
    || route.kind === "templates"
    || route.kind === "resumeCreate"
    || route.kind === "editor"
    || route.kind === "jobDetail"
    || route.kind === "interviews"
    || route.kind === "datasets"
    || route.kind === "mockInterview"
    || route.kind === "account";
  return usesLightWorkspace ? <div data-ui-theme="light">{loading}</div> : loading;
}

export function WorkspacePageBoundary({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  useLocale();
  // Keep the current page while the next module loads, avoiding a spinner between pages.
  const content = useDeferredValue(children);
  return (
    <Suspense fallback={fallback ?? (
      <main className="dashboard-content workspace-route-loading">
        <PageLoading label={t("正在加载模块…")} scope="workspace" />
      </main>
    )}>
      {content}
    </Suspense>
  );
}

// 页面代码下载期间：外壳照常显示，内容卡里画和该页一致的骨架，代码到了直接换成真实页面
function WorkspaceRouteLoading({ active }: { active: V3Section }) {
  useLocale();
  return (
    <V3Shell active={active} scroll={false}>
      <RouteSkeleton section={active} />
    </V3Shell>
  );
}

function AppContent() {
  const locale = useLocale();
  const route = useAppRoute();
  const currentLocation = `${window.location.pathname}${window.location.search}`;
  const routeResumeId = route.kind === "editor" ? route.resumeId : null;
  const isAdminArea = route.kind === "admin" || route.kind === "adminLogin";
  const [routeError, setRouteError] = useState<{ resumeId: string; message: string } | null>(null);
  const authStatus = useResumeStore((state) => state.authStatus);
  const userId = useResumeStore((state) => state.user?.id);
  useEffect(() => {
    if (isAdminArea) { setLocale("zh-CN", false); return; }
    let active = true;
    if (authStatus === "authenticated" && userId) {
      setLocale("zh-CN", false);
      const revision = getLocaleRevision();
      void api.getAccountPreferences().then((preferences) => { if (active && getLocaleRevision() === revision) setLocale(preferences.locale); }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [authStatus, userId, isAdminArea]);
  const activeResumeId = useResumeStore((state) => state.activeResumeId);
  const hydrate = useResumeStore((state) => state.hydrate);
  const loadResume = useResumeStore((state) => state.loadResume);
  const goHome = useResumeStore((state) => state.goHome);
  const dirty = useResumeStore((state) => state.dirty);
  const saveCurrentResume = useResumeStore((state) => state.saveCurrentResume);

  useEffect(() => {
    applyRouteSeo(route);
  }, [route, locale]);

  useEffect(() => {
    const redirect = legacyCareerRedirect(window.location.pathname, window.location.search);
    if (redirect) navigateTo(redirect, { replace: true });
  }, [currentLocation]);

  useEffect(() => {
    if (isAdminArea) return;
    void hydrate();
  }, [hydrate, isAdminArea]);

  useEffect(() => {
    if (authStatus !== "authenticated" || isAdminArea) return;
    return scheduleAuthenticatedWorkspacePreload();
  }, [authStatus, isAdminArea]);

  useEffect(() => {
    if (isAdminArea) return;
    const timer = startResumeAutosave(() => {
      const state = useResumeStore.getState();
      if (!state.dirty || !state.activeResumeId || state.versionOperationPending) return;
      void state.saveCurrentResume();
    });

    return () => window.clearInterval(timer);
  }, [isAdminArea]);

  useEffect(() => {
    if (isAdminArea) return;
    if (authStatus === "checking") return;

    if (authStatus === "guest") {
      if (
        route.kind === "resumes"
        || route.kind === "assistant"
        || route.kind === "templates"
        || route.kind === "resumeCreate"
        || route.kind === "editor"
        || route.kind === "jobDetail"
        || route.kind === "interviews"
        || route.kind === "datasets"
        || route.kind === "mockInterview"
        || route.kind === "account"
      ) {
        const next = `${window.location.pathname}${window.location.search}`;
        navigateTo(authPath("login", next), { replace: true });
      }
      return;
    }

    // 根入口进入当前环境工作区；/home 保持为显式公共落地页入口。
    if (route.kind === "auth" || (route.kind === "landing" && window.location.pathname === "/")) {
      navigateTo("/resumes", { replace: true });
    }
  }, [authStatus, currentLocation, route.kind]);

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
          throw new Error(t("当前简历保存失败，尚未切换。"));
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

  if (route.kind === "accountDeletion") return <AccountDeletionPage />;

  if (route.kind === "share") {
    return <SharePage token={route.token} />;
  }

  if (authStatus === "checking") {
    if (route.kind === "landing") {
      // 登录态检查期间就并行下载落地页模块，不必等检查结束再开始。
      void loadLandingPage();
      return <LandingLoading />;
    }
    return <PageLoading label={t("正在加载简历工作台…")} scope="page" />;
  }

  if (route.kind === "notFound") {
    // 登录后的 404 在工作区外壳里显示（10.4），访客看网页端 404（09.2）
    if (authStatus === "authenticated") {
      return (
        <WorkspacePageBoundary fallback={<WorkspaceRouteLoading active="none" />}>
          <V3Shell active="none">
            <InAppNotFound />
          </V3Shell>
        </WorkspacePageBoundary>
      );
    }
    return <NotFoundPage />;
  }

  if (route.kind === "landing") {
    return <LandingPage />;
  }

  if (authStatus === "guest") {
    if (route.kind === "auth") {
      return <AuthPage key={`${route.mode}:${route.next ?? ""}`} initialMode={route.mode} next={route.next} />;
    }

    return <PageLoading label={t("正在进入首页…")} scope="page" />;
  }

  if (route.kind === "resumeCreate") {
    return <ResumeCreatePage />;
  }

  if (route.kind === "assistant") {
    return (
      <WorkspacePageBoundary fallback={<WorkspaceRouteLoading active="home" />}>
        <AssistantPage sessionId={route.sessionId} workspaceSection={route.workspaceSection} careerView={route.careerView} />
      </WorkspacePageBoundary>
    );
  }

  // 模拟面试页面自己决定外壳（语音面试进行中是无侧栏整窗）
  if (route.kind === "mockInterview") {
    return (
      <WorkspacePageBoundary fallback={<WorkspaceRouteLoading active="mock" />}>
        <MockInterviewPage view={route.view} interviewId={route.interviewId} applicationId={route.applicationId} resumeId={route.resumeId} />
      </WorkspacePageBoundary>
    );
  }

  if (
    route.kind === "resumes"
    || route.kind === "templates"
    || route.kind === "jobDetail"
    || route.kind === "interviews"
    || route.kind === "datasets"
    || route.kind === "account"
  ) {
    const activeSection: V3Section = route.kind === "resumes"
      ? "resumes"
      : route.kind === "templates"
        ? "templates"
      : route.kind === "account"
        ? "account"
        : route.kind === "datasets"
          ? "datasets"
          : route.kind === "interviews" && route.view === "schedule"
            ? "schedule"
            : "jobs";

    return (
      <WorkspacePageBoundary fallback={<WorkspaceRouteLoading active={activeSection} />}>
        <V3Shell active={activeSection}>
          {route.kind === "resumes" && <HomePage />}
          {route.kind === "templates" && <ResumeTemplatesPage />}
          {route.kind === "jobDetail" && <JobDetailPage jobId={route.jobId} />}
          {route.kind === "interviews" && (
            <InterviewCenterPage
              view={route.view}
              initialApplicationId={route.applicationId}
              initialSessionId={route.sessionId}
              initialJobId={route.jobId}
              initialCreateApplication={route.createApplication}
              initialJobImport={route.importJob}
              moduleTitle={route.view === "schedule" ? t("面试排期") : route.view === "records" ? t("面试记录") : t("求职记录")}
            />
          )}
          {route.kind === "datasets" && <DatasetsPage initialFolderId={route.folderId} />}
          {route.kind === "account" && <AccountPage />}
        </V3Shell>
      </WorkspacePageBoundary>
    );
  }

  if (route.kind === "editor") {
    if (routeError?.resumeId === route.resumeId) {
      return (
        <EditorOpenError
          message={routeError.message}
          onBack={() => navigateTo("/resumes", { replace: true })}
          onRetry={() => {
            const resumeId = route.resumeId;
            setRouteError(null);
            void loadResume(resumeId).catch((error: unknown) => {
              setRouteError({ resumeId, message: resumeLoadErrorMessage(error) });
            });
          }}
        />
      );
    }
    if (activeResumeId !== route.resumeId) {
      return <V3Shell active="none" bare contentClassName="wb3-content"><PageLoading label={t("正在打开简历…")} scope="panel" /></V3Shell>;
    }
    return <ResumeWorkbench />;
  }

  return <PageLoading label={t("正在进入简历主页…")} scope="page" />;
}

export function resumeLoadErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 404) return t("简历不存在，或当前账号没有访问权限。");
    if (error.status === 401) return t("登录状态已失效，请重新登录后再试。");
    if (error.message === "RESUME_SCHEMA_INVALID") {
      return t("这份简历的数据格式暂时无法读取，请先完成数据迁移。");
    }
    if (error.status >= 500) return t("服务暂时无法读取这份简历，请稍后重试。");
  }
  return t("无法连接到服务，请检查本地服务后重试。");
}

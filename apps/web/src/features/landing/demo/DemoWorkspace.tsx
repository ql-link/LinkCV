import { lazy, Suspense, useEffect, useState } from "react";
import { AssistantPage } from "@/features/assistant/AssistantPage";
import { V3Shell, type V3Section } from "@/v3/Shell";
import { RouteSkeleton } from "@/v3/skeletons";
import { parseAppRoute, type AppRoute } from "@/routing";
import { useResumeStore } from "@/store/resumeStore";

const HomePage = lazy(() => import("@/features/home/HomePage").then(module => ({ default: module.HomePage })));
const ResumeTemplatesPage = lazy(() => import("@/features/templates/ResumeTemplatesPage").then(module => ({ default: module.ResumeTemplatesPage })));
const ResumeCreatePage = lazy(() => import("@/features/home/ResumeCreatePage").then(module => ({ default: module.ResumeCreatePage })));
const InterviewCenterPage = lazy(() => import("@/features/interviews/InterviewCenterPage").then(module => ({ default: module.InterviewCenterPage })));
const DatasetsPage = lazy(() => import("@/features/datasets/DatasetsPage").then(module => ({ default: module.DatasetsPage })));
const AccountPage = lazy(() => import("@/features/account/AccountPage").then(module => ({ default: module.AccountPage })));
const JobDetailPage = lazy(() => import("@/features/jobs/JobDetailPage").then(module => ({ default: module.JobDetailPage })));
const MockInterviewPage = lazy(() => import("@/features/mock-interview/MockInterviewPage").then(module => ({ default: module.MockInterviewPage })));
const ResumeWorkbench = lazy(() => import("@/features/workbench/ResumeWorkbench").then(module => ({ default: module.ResumeWorkbench })));


function Editor({ resumeId }: { resumeId: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { let active = true; setReady(false); void useResumeStore.getState().loadResume(resumeId).then(() => { if (active) setReady(true); }); return () => { active = false; if (useResumeStore.getState().dirty) void useResumeStore.getState().saveCurrentResume(); }; }, [resumeId]);
  useEffect(() => { if (!ready) return; const timer = setInterval(() => { if (useResumeStore.getState().dirty) void useResumeStore.getState().saveCurrentResume(); }, 1000); return () => clearInterval(timer); }, [ready]);
  return ready ? <ResumeWorkbench /> : <V3Shell active="resumes"><RouteSkeleton section="resumes" /></V3Shell>;
}
/** 路由对应的侧栏选中项；加载骨架也用它，避免首次进入页面时高亮先跳回首页再滑过去。 */
function sectionFor(route: AppRoute): V3Section {
  if (route.kind === "assistant") return "home";
  if (route.kind === "editor" || route.kind === "resumeCreate" || route.kind === "resumes") return "resumes";
  if (route.kind === "mockInterview") return "mock";
  if (route.kind === "templates") return "templates";
  if (route.kind === "datasets") return "datasets";
  if (route.kind === "account") return "account";
  if (route.kind === "interviews" && route.view === "schedule") return "schedule";
  return "jobs";
}
function Page({ route }: { route: AppRoute }) {
  if (route.kind === "assistant") return <AssistantPage sessionId={route.sessionId} workspaceSection={route.workspaceSection} careerView={route.careerView} />;
  if (route.kind === "editor") return <Editor resumeId={route.resumeId} />;
  if (route.kind === "resumeCreate") return <ResumeCreatePage />;
  if (route.kind === "mockInterview") return <MockInterviewPage view={route.view} interviewId={route.interviewId} applicationId={route.applicationId} resumeId={route.resumeId} />;
  return <V3Shell active={sectionFor(route)}>
    {route.kind === "resumes" && <HomePage />}
    {route.kind === "templates" && <ResumeTemplatesPage />}
    {route.kind === "datasets" && <DatasetsPage initialFolderId={route.folderId} />}
    {route.kind === "account" && <AccountPage />}
    {route.kind === "jobDetail" && <JobDetailPage jobId={route.jobId} />}
    {route.kind === "interviews" && <InterviewCenterPage view={route.view} initialApplicationId={route.applicationId} initialSessionId={route.sessionId} initialJobId={route.jobId} initialCreateApplication={route.createApplication} initialJobImport={route.importJob} moduleTitle={route.view === "schedule" ? "面试排期" : route.view === "records" ? "面试记录" : "求职记录"} />}
  </V3Shell>;
}
/**
 * 离线截图用的演示工作区（`scripts/capture-landing-demo.mjs`）。落地页只展示截好的图片，不加载这里。
 * 地址参数：`path` 指定打开的页面；`sidebar=neutral|active` 让侧栏全部按未选中或已选中样式渲染，
 * 落地页用两张侧栏图叠加实现选中项滑动。
 */
export function DemoWorkspace() {
  const params = new URLSearchParams(location.search);
  const [path, setPath] = useState(params.get("path") ?? "/assistant");
  const sidebar = params.get("sidebar");
  const url = new URL(path, location.origin);
  const route = parseAppRoute(url.pathname, url.search);
  useEffect(() => {
    const navigate = (event: Event) => {
      const destination = (event as CustomEvent<{ path: string }>).detail.path;
      if (!destination.startsWith("/")) return;
      event.preventDefault(); setPath(destination);
    };
    window.addEventListener("linkresume:showcase-navigate", navigate);
    return () => window.removeEventListener("linkresume:showcase-navigate", navigate);
  }, []);
  return <div className="np-product v3 np-home" aria-label="产品演示 · 示例数据" data-demo-route={path} data-capture-sidebar={sidebar ?? undefined}>
    <Suspense fallback={<V3Shell active={sectionFor(route)}><RouteSkeleton section={sectionFor(route)} /></V3Shell>}><Page route={route} /></Suspense>
  </div>;
}

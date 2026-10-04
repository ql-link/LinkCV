import { lazy, Suspense, useEffect, useRef, useState } from "react";
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


function scrollLanding(deltaY: number) {
  if (window.parent !== window) window.parent.postMessage({ type: "linkresume:landing-scroll", deltaY }, location.origin);
}

function Editor({ resumeId }: { resumeId: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { let active = true; setReady(false); void useResumeStore.getState().loadResume(resumeId).then(() => { if (active) setReady(true); }); return () => { active = false; if (useResumeStore.getState().dirty) void useResumeStore.getState().saveCurrentResume(); }; }, [resumeId]);
  useEffect(() => { if (!ready) return; const timer = setInterval(() => { if (useResumeStore.getState().dirty) void useResumeStore.getState().saveCurrentResume(); }, 1000); return () => clearInterval(timer); }, [ready]);
  return ready ? <ResumeWorkbench /> : <V3Shell active="resumes"><RouteSkeleton section="resumes" /></V3Shell>;
}
function Page({ route }: { route: AppRoute }) {
  if (route.kind === "assistant") return <AssistantPage sessionId={route.sessionId} workspaceSection={route.workspaceSection} careerView={route.careerView} />;
  if (route.kind === "editor") return <Editor resumeId={route.resumeId} />;
  if (route.kind === "resumeCreate") return <ResumeCreatePage />;
  if (route.kind === "mockInterview") return <MockInterviewPage view={route.view} interviewId={route.interviewId} applicationId={route.applicationId} resumeId={route.resumeId} />;
  const active: V3Section = route.kind === "resumes" ? "resumes" : route.kind === "templates" ? "templates" : route.kind === "datasets" ? "datasets" : route.kind === "account" ? "account" : route.kind === "interviews" && route.view === "schedule" ? "schedule" : "jobs";
  return <V3Shell active={active}>
    {route.kind === "resumes" && <HomePage />}
    {route.kind === "templates" && <ResumeTemplatesPage />}
    {route.kind === "datasets" && <DatasetsPage initialFolderId={route.folderId} />}
    {route.kind === "account" && <AccountPage />}
    {route.kind === "jobDetail" && <JobDetailPage jobId={route.jobId} />}
    {route.kind === "interviews" && <InterviewCenterPage view={route.view} initialApplicationId={route.applicationId} initialSessionId={route.sessionId} initialJobId={route.jobId} initialCreateApplication={route.createApplication} initialJobImport={route.importJob} moduleTitle={route.view === "schedule" ? "面试排期" : route.view === "records" ? "面试记录" : "求职记录"} />}
  </V3Shell>;
}
export function DemoWorkspace({ onEditingChange, paused = false }: { onEditingChange?: (editing: boolean) => void; paused?: boolean }) {
  const [path, setPath] = useState("/assistant");
  const host = useRef<HTMLDivElement>(null);
  const url = new URL(path, location.origin);
  const route = parseAppRoute(url.pathname, url.search);
  useEffect(() => {
    const navigate = (event: Event) => {
      const destination = (event as CustomEvent<{ path: string }>).detail.path;
      if (!destination.startsWith("/")) return;
      event.preventDefault(); onEditingChange?.(parseAppRoute(new URL(destination, location.origin).pathname).kind === "editor"); setPath(destination);
    };
    window.addEventListener("linkresume:showcase-navigate", navigate);
    return () => window.removeEventListener("linkresume:showcase-navigate", navigate);
  }, [onEditingChange]);
  useEffect(() => {
    const element = host.current; if (!element) return;
    // Browsing the landing must never consume wheel events in its embedded
    // scroll containers. Source-managed scrolling for new replies still works.
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault(); event.stopPropagation();
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      scrollLanding(event.deltaY * multiplier);
    };
    let touchY: number | null = null;
    const start = (event: TouchEvent) => { touchY = event.touches.length === 1 ? event.touches[0].clientY : null; };
    const move = (event: TouchEvent) => {
      if (touchY === null || event.touches.length !== 1) return;
      const next = event.touches[0].clientY;
      event.preventDefault(); scrollLanding(touchY - next); touchY = next;
    };
    element.addEventListener("wheel", wheel, { passive: false, capture: true });
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    return () => { element.removeEventListener("wheel", wheel, true); element.removeEventListener("touchstart", start); element.removeEventListener("touchmove", move); };
  }, []);
  return <div ref={host} className="np-product v3 np-home" aria-label="产品互动演示 · 示例数据" data-demo-route={path}>
    <Suspense fallback={<V3Shell active="home"><RouteSkeleton section="home" /></V3Shell>}>{!paused && <Page route={route} />}</Suspense>
  </div>;
}

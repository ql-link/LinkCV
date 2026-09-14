export const loadAccountPage = () => import("./features/account/AccountPage");
export const loadAssistantPage = () => import("./features/assistant/AssistantPage");
export const loadDatasetsPage = () => import("./features/datasets/DatasetsPage");
export const loadHomePage = () => import("./features/home/HomePage");
export const loadInterviewCenterPage = () => import("./features/interviews/InterviewCenterPage");
export const loadResumeTemplatesPage = () => import("./features/templates/ResumeTemplatesPage");

export const AUTHENTICATED_IDLE_PRELOAD_PATHS = ["/templates", "/datasets"] as const;
export const WORKSPACE_IDLE_PRELOAD_TIMEOUT_MS = 2_000;

const workspacePageLoaders: Record<string, () => Promise<unknown>> = {
  "/account": loadAccountPage,
  "/assistant": loadAssistantPage,
  "/career": loadInterviewCenterPage,
  "/career/applications": loadInterviewCenterPage,
  "/career/jobs": loadInterviewCenterPage,
  "/career/reviews": loadInterviewCenterPage,
  "/career/schedule": loadInterviewCenterPage,
  "/datasets": loadDatasetsPage,
  "/interviews": loadInterviewCenterPage,
  "/jobs": loadInterviewCenterPage,
  "/resumes": loadHomePage,
  "/templates": loadResumeTemplatesPage,
};

export function preloadWorkspacePage(path: string) {
  const pathname = path.split("?", 1)[0] ?? path;
  const loader = workspacePageLoaders[pathname];
  if (loader) void loader().catch(() => undefined);
}

type WorkspacePreloadWindow = Pick<Window, "setTimeout" | "clearTimeout">
  & Partial<Pick<Window, "requestIdleCallback" | "cancelIdleCallback">>;

export function scheduleAuthenticatedWorkspacePreload({
  target = window,
  preload = preloadWorkspacePage,
}: {
  target?: WorkspacePreloadWindow;
  preload?: (path: string) => void;
} = {}) {
  const run = () => {
    AUTHENTICATED_IDLE_PRELOAD_PATHS.forEach(preload);
  };

  if (typeof target.requestIdleCallback === "function") {
    const idleId = target.requestIdleCallback(run, { timeout: WORKSPACE_IDLE_PRELOAD_TIMEOUT_MS });
    return () => target.cancelIdleCallback?.(idleId);
  }

  const timerId = target.setTimeout(run, WORKSPACE_IDLE_PRELOAD_TIMEOUT_MS);
  return () => target.clearTimeout(timerId);
}

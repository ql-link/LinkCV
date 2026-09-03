export const loadAccountPage = () => import("./features/account/AccountPage");
export const loadAssistantPage = () => import("./features/assistant/AssistantPage");
export const loadDatasetsPage = () => import("./features/datasets/DatasetsPage");
export const loadHomePage = () => import("./features/home/HomePage");
export const loadInterviewCenterPage = () => import("./features/interviews/InterviewCenterPage");
export const loadResumeTemplatesPage = () => import("./features/templates/ResumeTemplatesPage");

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

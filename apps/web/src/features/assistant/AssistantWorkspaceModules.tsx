import { lazy, Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { type AssistantWorkspaceSection } from "../../routing";
import {
  loadDatasetsPage,
  loadHomePage,
  loadInterviewCenterPage,
  loadResumeTemplatesPage,
} from "../../workspacePageLoaders";

const HomePage = lazy(() => loadHomePage().then((module) => ({ default: module.HomePage })));
const ResumeTemplatesPage = lazy(() => loadResumeTemplatesPage().then((module) => ({ default: module.ResumeTemplatesPage })));
const InterviewCenterPage = lazy(() => loadInterviewCenterPage().then((module) => ({ default: module.InterviewCenterPage })));
const DatasetsPage = lazy(() => loadDatasetsPage().then((module) => ({ default: module.DatasetsPage })));

export function AssistantWorkspaceModules({
  section,
  careerView = "applications",
}: {
  section: AssistantWorkspaceSection;
  careerView?: "applications" | "schedule";
}) {
  return (
    <div className="assistant-module-content">
      <Suspense fallback={<PageLoading label="正在加载工作台模块…" scope="workspace" />}>
        {section === "resumes" && <HomePage />}
        {section === "templates" && <ResumeTemplatesPage />}
        {section === "career" && (
          <InterviewCenterPage
            view={careerView}
            moduleTitle={careerView === "schedule" ? "面试排期" : "求职记录"}
          />
        )}
        {section === "datasets" && <DatasetsPage embedded />}
      </Suspense>
    </div>
  );
}

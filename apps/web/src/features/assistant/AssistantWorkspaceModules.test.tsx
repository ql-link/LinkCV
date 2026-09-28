import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantWorkspaceModules } from "./AssistantWorkspaceModules";

vi.mock("../../workspacePageLoaders", () => ({
  loadHomePage: async () => ({ HomePage: () => <main>简历模块内容</main> }),
  loadResumeTemplatesPage: async () => ({ ResumeTemplatesPage: () => <main>模板模块内容</main> }),
  loadInterviewCenterPage: async () => ({
    InterviewCenterPage: ({ view, moduleTitle }: { view: string; moduleTitle: string }) => (
      <main><h1>{moduleTitle}</h1><span>求职中心：{view}</span></main>
    ),
  }),
  loadDatasetsPage: async () => ({ DatasetsPage: ({ embedded }: { embedded: boolean }) => <main>资料库模块：{String(embedded)}</main> }),
}));

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("AssistantWorkspaceModules", () => {
  it("在工作台右侧复用模块内容，并按左侧入口显示求职记录或面试排期", async () => {
    const { rerender } = render(<AssistantWorkspaceModules section="resumes" />);
    expect(await screen.findByText("简历模块内容")).toBeInTheDocument();

    rerender(<AssistantWorkspaceModules section="templates" />);
    expect(await screen.findByText("模板模块内容")).toBeInTheDocument();

    rerender(<AssistantWorkspaceModules section="career" />);
    expect(await screen.findByText("求职中心：applications")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "求职记录" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "求职中心导航" })).not.toBeInTheDocument();

    rerender(<AssistantWorkspaceModules section="career" careerView="schedule" />);
    expect(await screen.findByText("求职中心：schedule")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "面试排期" })).toBeInTheDocument();

    rerender(<AssistantWorkspaceModules section="datasets" />);
    expect(await screen.findByText("资料库模块：true")).toBeInTheDocument();
  });
});

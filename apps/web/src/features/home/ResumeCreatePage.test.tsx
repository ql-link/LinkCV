import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { ResumeCreatePage } from "./ResumeCreatePage";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listResumeTemplates: vi.fn(),
    },
  };
});

vi.mock("../preview/ResumePreview", () => ({
  ResumePreview: ({ layoutPlan, mode = "card" }: { layoutPlan?: unknown; mode?: "card" | "full" }) => (
    <div data-testid={`resume-preview-${mode}`} data-layout-plan={layoutPlan ? "present" : "missing"} />
  ),
}));

// 侧栏会读取会话列表，这里只关心新建 / 导入流程
vi.mock("../../v3/Shell", () => ({
  V3Shell: ({ children }: { children: React.ReactNode }) => <div data-testid="v3-shell">{children}</div>,
}));

const layoutPlan = { schema_version: "layout-plan.v1", regions: [] };
const templates = [
  { id: "9", key: "classic-technical-cn", name: "经典单页技术简历", description: null, data: {}, style: {}, layout_plan: layoutPlan },
  { id: "10", key: "civic-service-cn", name: "蓝色政务行政", description: null, data: {}, style: {}, layout_plan: layoutPlan },
];

function mockTemplates() {
  vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
}

describe("ResumeCreatePage", () => {
  beforeEach(() => {
    useResumeStore.setState({ resumes: [], activeImports: [], failedImports: [], listResumes: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/resumes/new");
  });

  it("在列表底图上打开新建弹窗，默认选中首个模板并提交名称和模板 ID", async () => {
    mockTemplates();
    const createResume = vi.fn().mockResolvedValue("12");
    useResumeStore.setState({ createResume });
    window.history.replaceState(null, "", "/resumes/new");
    render(<ResumeCreatePage />);

    const dialog = await screen.findByRole("dialog", { name: "新建简历" });
    expect(screen.getByRole("heading", { name: "我的简历" })).toBeInTheDocument();
    expect(await within(dialog).findByRole("option", { name: "经典单页技术简历，已选择" })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("简历名称"), { target: { value: "2026 产品经理简历" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建并进入编辑器" }));

    await waitFor(() => {
      expect(createResume).toHaveBeenCalledWith("2026 产品经理简历", "9");
      expect(window.location.pathname).toBe("/resumes/12/edit");
    });
  });

  it("?template= 预选指定模板，预览继续传递服务端布局计划", async () => {
    mockTemplates();
    window.history.replaceState(null, "", "/resumes/new?template=10");
    render(<ResumeCreatePage />);

    expect(await screen.findByRole("option", { name: "蓝色政务行政，已选择" })).toBeInTheDocument();
    expect(screen.getByTestId("resume-preview-card")).toHaveAttribute("data-layout-plan", "present");
  });

  it("名称重复时留在新建页并显示明确错误", async () => {
    mockTemplates();
    useResumeStore.setState({
      createResume: vi.fn().mockRejectedValue(new ApiRequestError(409, "RESUME_TITLE_CONFLICT")),
    });
    render(<ResumeCreatePage />);

    await screen.findByRole("option", { name: /经典单页技术简历/ });
    fireEvent.change(screen.getByLabelText("简历名称"), { target: { value: "重复名称" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并进入编辑器" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("该名称已经存在，请换一个名称。");
    expect(window.location.pathname).toBe("/resumes/new");
  });

  it("关闭弹窗回到简历列表", async () => {
    mockTemplates();
    render(<ResumeCreatePage />);

    fireEvent.click(await screen.findByRole("button", { name: "取消" }));
    expect(window.location.pathname).toBe("/resumes");
  });

  it("导入模式选择文件后自动填写名称，受理后回到简历列表", async () => {
    mockTemplates();
    const importResume = vi.fn().mockResolvedValue("task-1");
    useResumeStore.setState({ importResume });
    window.history.replaceState(null, "", "/resumes/new?mode=import");
    render(<ResumeCreatePage />);

    const file = new File(["# Zhang San"], "resume.md", { type: "text/markdown" });
    fireEvent.change(await screen.findByLabelText(/选择 Markdown/), { target: { files: [file] } });
    expect(screen.getByLabelText("简历名称")).toHaveValue("resume");

    fireEvent.click(await screen.findByRole("button", { name: "导入并开始解析" }));
    await waitFor(() => {
      expect(importResume).toHaveBeenCalledWith(file, "9", "resume");
      expect(window.location.pathname).toBe("/resumes");
    });
  });

  it("结构化模型未配置时显示具体错误", async () => {
    mockTemplates();
    useResumeStore.setState({
      importResume: vi.fn().mockRejectedValue(new ApiRequestError(503, "STRUCTURING_MODEL_UNAVAILABLE")),
    });
    window.history.replaceState(null, "", "/resumes/new?mode=import");
    render(<ResumeCreatePage />);

    const file = new File(["# 张三"], "张三简历.md", { type: "text/markdown" });
    fireEvent.change(await screen.findByLabelText(/选择 Markdown/), { target: { files: [file] } });
    fireEvent.click(await screen.findByRole("button", { name: "导入并开始解析" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("内容结构化模型未配置或凭据不可用，请联系管理员配置后重试。");
    expect(window.location.pathname).toBe("/resumes/new");
  });
});

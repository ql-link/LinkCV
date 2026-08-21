import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  ResumePreview: () => <div data-testid="resume-preview" />,
}));

const templates = [
  { id: "8", key: "blank-cn", name: "空白简历", description: null, data: {}, style: {} },
  { id: "9", key: "modern-cn", name: "现代双栏", description: null, data: {}, style: {} },
];

function mockTemplates() {
  vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
}

describe("ResumeCreatePage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/resumes/new");
  });

  it("默认选中首个模板，可把名称和模板 ID 提交给创建契约", async () => {
    mockTemplates();
    const createResume = vi.fn().mockResolvedValue("12");
    useResumeStore.setState({ createResume });
    window.history.replaceState(null, "", "/resumes/new");
    render(<ResumeCreatePage />);

    fireEvent.click(await screen.findByRole("option", { name: /现代双栏/ }));
    fireEvent.change(screen.getByLabelText("简历名称"), {
      target: { value: "2026 产品经理简历" },
    });
    fireEvent.click(screen.getByRole("button", { name: /创建并进入编辑器/ }));

    await waitFor(() => {
      expect(createResume).toHaveBeenCalledWith("2026 产品经理简历", "9");
      expect(window.location.pathname).toBe("/resumes/12/edit");
    });
  });

  it("名称重复时留在新建页并显示明确错误", async () => {
    mockTemplates();
    useResumeStore.setState({
      createResume: vi.fn().mockRejectedValue(
        new ApiRequestError(409, "RESUME_TITLE_CONFLICT"),
      ),
    });
    render(<ResumeCreatePage />);

    await screen.findByRole("option", { name: /空白简历/ });
    fireEvent.change(screen.getByLabelText("简历名称"), {
      target: { value: "重复名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: /创建并进入编辑器/ }));

    expect(await screen.findByText("该名称已经存在，请换一个名称。")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/resumes/new");
  });

  it("导入模式选择文件后自动填写名称，受理后返回简历列表", async () => {
    mockTemplates();
    const importResume = vi.fn().mockResolvedValue("task-1");
    useResumeStore.setState({ importResume });
    window.history.replaceState(null, "", "/resumes/new?mode=import");
    render(<ResumeCreatePage />);

    const file = new File(["# Zhang San"], "resume.md", { type: "text/markdown" });
    fireEvent.change(await screen.findByLabelText(/选择 Markdown/), { target: { files: [file] } });
    expect(screen.getByLabelText("简历名称")).toHaveValue("resume");

    fireEvent.click(screen.getByRole("button", { name: /导入并开始解析/ }));
    await waitFor(() => {
      expect(importResume).toHaveBeenCalledWith(file, "8", "resume");
      expect(window.location.pathname).toBe("/resumes");
    });
  });

  it("结构化模型未配置时显示具体错误", async () => {
    mockTemplates();
    useResumeStore.setState({
      importResume: vi.fn().mockRejectedValue(
        new ApiRequestError(503, "STRUCTURING_MODEL_UNAVAILABLE"),
      ),
    });
    window.history.replaceState(null, "", "/resumes/new?mode=import");
    render(<ResumeCreatePage />);

    const file = new File(["# 张三"], "张三简历.md", { type: "text/markdown" });
    fireEvent.change(await screen.findByLabelText(/选择 Markdown/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /导入并开始解析/ }));

    expect(
      await screen.findByText("内容结构化模型未配置或凭据不可用，请联系管理员配置后重试。"),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/resumes/new");
  });
});

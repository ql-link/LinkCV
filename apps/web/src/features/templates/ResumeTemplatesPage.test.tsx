import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, api } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { ResumeTemplatesPage } from "./ResumeTemplatesPage";

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
  { id: "8", key: "blank-cn", name: "空白简历", description: "从空白内容开始", data: {}, style: {} },
  { id: "9", key: "modern-cn", name: "现代双栏", description: null, data: {}, style: {} },
];

beforeEach(() => {
  window.history.replaceState(null, "", "/templates");
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/templates");
});

describe("ResumeTemplatesPage", () => {
  it("从模板卡片打开命名弹窗并直接创建简历", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    const createResume = vi.fn().mockResolvedValue("12");
    useResumeStore.setState({ createResume });
    render(<ResumeTemplatesPage />);

    expect(await screen.findByRole("heading", { name: "现代双栏" })).toBeInTheDocument();
    expect(screen.getAllByTestId("resume-preview")).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "创建简历" })[1]);
    expect(screen.getByRole("dialog")).toHaveTextContent("基于“现代双栏”创建简历");
    expect(window.location.pathname).toBe("/templates");

    fireEvent.change(screen.getByLabelText("简历名称"), {
      target: { value: " 2026 产品经理简历 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    await waitFor(() => {
      expect(createResume).toHaveBeenCalledWith("2026 产品经理简历", "9");
      expect(window.location.pathname).toBe("/resumes/12/edit");
    });
  });

  it("名称为空时留在弹窗并阻止创建", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    const createResume = vi.fn();
    useResumeStore.setState({ createResume });
    render(<ResumeTemplatesPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "创建简历" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    expect(await screen.findByText("请输入简历名称。")).toBeInTheDocument();
    expect(createResume).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("创建失败时保留弹窗并显示明确错误", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    useResumeStore.setState({
      createResume: vi.fn().mockRejectedValue(new ApiRequestError(409, "RESUME_TITLE_CONFLICT")),
    });
    render(<ResumeTemplatesPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "创建简历" }))[0]);
    fireEvent.change(screen.getByLabelText("简历名称"), { target: { value: "重复名称" } });
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    expect(await screen.findByText("该名称已经存在，请换一个名称。")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/templates");
  });

  it("读取失败时提供可操作的重新加载", async () => {
    vi.mocked(api.listResumeTemplates)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ templates } as never);
    render(<ResumeTemplatesPage />);

    expect(await screen.findByRole("heading", { name: "模板暂时无法加载" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("heading", { name: "空白简历" })).toBeInTheDocument();
  });

  it("没有启用模板时展示空状态并允许返回简历列表", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates: [] });
    render(<ResumeTemplatesPage />);

    expect(await screen.findByRole("heading", { name: "当前没有可用模板" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "返回全部简历" }));
    expect(window.location.pathname).toBe("/resumes");
  });
});

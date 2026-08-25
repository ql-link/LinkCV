import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  ResumePreview: ({ mode = "card" }: { mode?: "card" | "full" }) => (
    <div data-testid={`resume-preview-${mode}`} />
  ),
}));

const templates = [
  { id: "8", key: "classic-technical-cn", name: "经典单页技术简历", description: "技术岗位单页版式", data: {}, style: {} },
  { id: "9", key: "modern-cn", name: "现代双栏", description: null, data: {}, style: {} },
  { id: "10", key: "campus-cn", name: "校园简历", description: "适合校招求职", data: {}, style: {} },
];

beforeEach(() => {
  window.history.replaceState(null, "", "/templates");
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/templates");
});

describe("ResumeTemplatesPage", () => {
  it("首次读取时在页头下方展示统一加载状态", () => {
    vi.mocked(api.listResumeTemplates).mockReturnValue(new Promise(() => undefined));

    const { container } = render(<ResumeTemplatesPage />);

    expect(screen.getByRole("status", { name: "正在加载简历模板…" })).toBeInTheDocument();
    expect(container.querySelector(".template-library-content > .page-loading")).toBeInTheDocument();
    expect(container.querySelector(".template-library-body")).not.toBeInTheDocument();
  });

  it("从模板卡片打开命名弹窗并直接创建简历", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    const createResume = vi.fn().mockResolvedValue("12");
    useResumeStore.setState({ createResume });
    render(<ResumeTemplatesPage />);

    expect(await screen.findByRole("heading", { name: "现代双栏" })).toBeInTheDocument();
    expect(screen.getAllByTestId("resume-preview-card")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "创建简历" })[0]).toHaveClass("bg-[var(--ui-accent)]");

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

  it("点击模板卡片打开大尺寸预览，并可继续进入命名弹窗", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    render(<ResumeTemplatesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "查看模板：现代双栏" }));

    const previewDialog = screen.getByRole("dialog", { name: "现代双栏" });
    expect(previewDialog).toHaveClass("template-preview-dialog");
    expect(within(previewDialog).getByTestId("resume-preview-full")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/templates");

    fireEvent.click(within(previewDialog).getByRole("button", { name: "创建简历" }));

    expect(screen.getByRole("dialog", { name: "创建简历" })).toHaveTextContent(
      "基于“现代双栏”创建简历",
    );
    expect(screen.queryByRole("dialog", { name: "现代双栏" })).not.toBeInTheDocument();
  });

  it("仅在按住 Ctrl 或 Command 时缩放模板预览", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    render(<ResumeTemplatesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "查看模板：经典单页技术简历" }));

    const previewDialog = screen.getByRole("dialog", { name: "经典单页技术简历" });
    const stage = previewDialog.querySelector(".template-preview-dialog-stage");
    expect(stage).not.toBeNull();
    expect(within(previewDialog).getByLabelText("模板预览缩放比例")).toHaveTextContent("72%");

    fireEvent.wheel(stage!, { deltaY: -100 });
    expect(within(previewDialog).getByLabelText("模板预览缩放比例")).toHaveTextContent("72%");

    fireEvent.wheel(stage!, { ctrlKey: true, deltaY: -100 });
    await waitFor(() => {
      expect(within(previewDialog).getByLabelText("模板预览缩放比例")).toHaveTextContent("80%");
    });

    fireEvent.wheel(stage!, { metaKey: true, deltaY: 100 });
    await waitFor(() => {
      expect(within(previewDialog).getByLabelText("模板预览缩放比例")).toHaveTextContent("72%");
    });
  });

  it("可以通过预览工具栏放大和缩小模板", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    render(<ResumeTemplatesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "查看模板：经典单页技术简历" }));

    const previewDialog = screen.getByRole("dialog", { name: "经典单页技术简历" });
    const scale = within(previewDialog).getByLabelText("模板预览缩放比例");

    fireEvent.click(within(previewDialog).getByRole("button", { name: "放大模板" }));
    expect(scale).toHaveTextContent("80%");

    fireEvent.click(within(previewDialog).getByRole("button", { name: "缩小模板" }));
    expect(scale).toHaveTextContent("72%");
  });

  it("可以使用按钮和方向键循环切换相邻模板，并保留缩放比例", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    render(<ResumeTemplatesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "查看模板：现代双栏" }));

    let previewDialog = screen.getByRole("dialog", { name: "现代双栏" });
    fireEvent.click(within(previewDialog).getByRole("button", { name: "放大模板" }));
    fireEvent.click(within(previewDialog).getByRole("button", { name: "下一个模板：校园简历" }));

    previewDialog = screen.getByRole("dialog", { name: "校园简历" });
    expect(within(previewDialog).getByLabelText("模板预览缩放比例")).toHaveTextContent("80%");
    expect(within(previewDialog).getByRole("button", { name: "上一个模板：现代双栏" })).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: "下一个模板：经典单页技术简历" })).toBeInTheDocument();

    fireEvent.keyDown(previewDialog, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "经典单页技术简历" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "经典单页技术简历" }), { key: "ArrowLeft" });
    expect(screen.getByRole("dialog", { name: "校园简历" })).toBeInTheDocument();
  });

  it("卡片内的创建按钮不会误触模板预览", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    render(<ResumeTemplatesPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "创建简历" }))[0]);

    expect(screen.getByRole("dialog", { name: "创建简历" })).toHaveTextContent(
      "基于“经典单页技术简历”创建简历",
    );
    expect(screen.queryByTestId("resume-preview-full")).not.toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: "经典单页技术简历" })).toBeInTheDocument();
  });

  it("没有启用模板时展示空状态并允许返回简历列表", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates: [] });
    render(<ResumeTemplatesPage />);

    expect(await screen.findByRole("heading", { name: "当前没有可用模板" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "返回全部简历" }));
    expect(window.location.pathname).toBe("/resumes");
  });
});

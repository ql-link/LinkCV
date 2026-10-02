import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, api } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { setLocale } from "../../i18n";
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
  { id: "8", key: "classic-technical-cn", use_count: 3200, name: "经典单页技术简历", description: "技术岗位单页版式", style_categories: ["经典"], use_cases: ["校招"], data: {}, style: {} },
  { id: "9", key: "modern-cn", use_count: 980, name: "现代双栏", description: null, style_categories: ["现代"], use_cases: ["社招"], data: {}, style: {} },
  { id: "10", key: "campus-cn", use_count: 12, name: "校园简历", description: "适合校招求职", style_categories: ["简约", "现代"], use_cases: ["校招"], data: {}, style: {} },
];

// V3 卡片本身不放「创建简历」按钮：点卡片打开 03.1a 预览，再点预览里的主按钮进入命名弹窗
async function openCreateFromPreview(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: `查看模板：${name}` }));
  const previewDialog = screen.getByRole("dialog", { name });
  fireEvent.click(within(previewDialog).getByRole("button", { name: "创建简历" }));
}

beforeEach(() => {
  window.history.replaceState(null, "", "/templates");
});

afterEach(() => {
  setLocale("zh-CN", false);
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/templates");
});

describe("ResumeTemplatesPage", () => {
  it("英文界面翻译分类标签，同时保留模板名称和筛选的原始分类值", async () => {
    setLocale("en-US", false);
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    render(<ResumeTemplatesPage />);
    await screen.findByRole("button", { name: "View template: 经典单页技术简历" });
    expect(screen.getAllByText("Classic").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Filter resume templates" }));
    fireEvent.click(screen.getByRole("button", { name: "Modern" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "View template: 经典单页技术简历" })).toBeNull());
    expect(screen.getByRole("button", { name: "View template: 现代双栏" })).toBeInTheDocument();
  });

  it("保留接口展示顺序，新增目录整理不会重排原有模板", async () => {
    const additions = [
      { ...templates[1], id: "100", key: "muse-mist-cn", name: "雾青圆章" },
      { ...templates[1], id: "101", key: "muse-badge-cn", name: "蓝笺工牌" },
    ];
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates: [...templates, ...additions] } as never);
    render(<ResumeTemplatesPage />);
    await screen.findByRole("button", { name: "查看模板：蓝笺工牌" });
    const names = () => screen.getAllByRole("button", { name: /^查看模板：/ }).map((button) => button.getAttribute("aria-label"));
    expect(names()).toEqual([...templates, ...additions].map((template) => `查看模板：${template.name}`));
    fireEvent.click(screen.getByRole("button", { name: "筛选简历模板" }));
    fireEvent.click(screen.getByRole("button", { name: "现代" }));
    await waitFor(() => expect(names()).toEqual([
      "查看模板：现代双栏", "查看模板：校园简历", "查看模板：雾青圆章", "查看模板：蓝笺工牌",
    ]));
  });

  it("点击风格和场景后立即筛选，并支持重置与空结果", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    render(<ResumeTemplatesPage />);
    await screen.findByRole("heading", { name: "现代双栏" });
    const filterButton = screen.getByRole("button", { name: "筛选简历模板" });
    // The server owns catalog ordering; usage mocks are display-only.
    expect(screen.getByText("找到 3 套模板")).toBeInTheDocument();
    expect(screen.getByText("按展示顺序")).toBeInTheDocument();

    fireEvent.click(filterButton);
    fireEvent.click(screen.getByRole("button", { name: "现代" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "经典单页技术简历" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "校招" }));
    expect(screen.getByRole("heading", { name: "校园简历" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "现代双栏" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "实习" }));
    fireEvent.click(screen.getByRole("button", { name: "校招" }));
    expect(await screen.findByRole("heading", { name: "没有符合条件的模板" })).toBeInTheDocument();
    expect(screen.getByText("找到 0 套模板")).toBeInTheDocument();
    expect(filterButton).toHaveTextContent("筛选 · 2");
    expect(screen.getByText("「现代」风格和「实习」场景同时选中时没有模板。试试减少一个筛选条件。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(await screen.findByRole("heading", { name: "现代双栏" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "现代" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "重置筛选" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "经典" }));
    fireEvent.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(screen.getByRole("button", { name: "经典" })).toHaveAttribute("aria-pressed", "false");
  });

  it("关闭筛选下拉层后保留已生效的选择", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    render(<ResumeTemplatesPage />);
    await screen.findByRole("heading", { name: "现代双栏" });

    fireEvent.click(screen.getByRole("button", { name: "筛选简历模板" }));
    fireEvent.click(screen.getByRole("button", { name: "现代" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "经典单页技术简历" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "筛选简历模板" }));
    expect(screen.getByRole("button", { name: "现代" })).toHaveAttribute("aria-pressed", "true");
  });
  it("首次读取时在页头下方展示统一加载状态", () => {
    vi.mocked(api.listResumeTemplates).mockReturnValue(new Promise(() => undefined));

    const { container } = render(<ResumeTemplatesPage />);

    expect(screen.getByRole("status", { name: "正在加载简历模板…" })).toBeInTheDocument();
    expect(container.querySelector(".tpl-page > .tpl-body .v3-skeleton.v3-sk-grid")).toBeInTheDocument();
    expect(container.querySelector(".tpl-grid:not(.v3-skeleton)")).not.toBeInTheDocument();
  });

  it("模板卡片展示风格和场景标签、使用次数，并保留接口展示顺序", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    const { container } = render(<ResumeTemplatesPage />);
    await screen.findByRole("heading", { name: "现代双栏" });

    const cards = Array.from(container.querySelectorAll(".tpl-card"));
    const uses = cards.map((card) => card.querySelector(".tpl-card-uses")?.textContent ?? "");
    expect(uses).toEqual(["3.2k 使用", "980 使用", "12 使用"]);
    const campus = cards.find((card) => card.textContent?.includes("校园简历"))!;
    expect(within(campus as HTMLElement).getByText("简约")).toHaveClass("v3-chip");
    expect(within(campus as HTMLElement).getByText("校招")).toHaveClass("v3-chip");
    expect(cards.map((card) => card.querySelector('button[aria-label^="查看模板："]')?.getAttribute("aria-label")))
      .toEqual(templates.map((template) => `查看模板：${template.name}`));
  });

  it("从模板预览打开命名弹窗并创建简历", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    const createResume = vi.fn().mockResolvedValue("12");
    useResumeStore.setState({ createResume });
    render(<ResumeTemplatesPage />);

    expect(await screen.findByRole("heading", { name: "现代双栏" })).toBeInTheDocument();
    expect(screen.getAllByTestId("resume-preview-card")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "创建简历" })).not.toBeInTheDocument();

    await openCreateFromPreview("现代双栏");
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
    expect(previewDialog).toHaveClass("tpl-preview-dialog");
    expect(within(previewDialog).getByRole("button", { name: "创建简历" })).toHaveClass("v3-btn-dark");
    expect(previewDialog).toHaveTextContent("980 使用");
    expect(within(previewDialog).queryByText("需后端")).not.toBeInTheDocument();
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
    const stage = previewDialog.querySelector(".tpl-preview-scroll");
    expect(stage).not.toBeNull();
    expect(within(previewDialog).getByLabelText("模板预览缩放比例")).toHaveTextContent("100%");

    fireEvent.wheel(stage!, { deltaY: -100 });
    expect(within(previewDialog).getByLabelText("模板预览缩放比例")).toHaveTextContent("100%");

    fireEvent.wheel(stage!, { ctrlKey: true, deltaY: -100 });
    await waitFor(() => {
      expect(within(previewDialog).getByLabelText("模板预览缩放比例")).toHaveTextContent("110%");
    });

    fireEvent.wheel(stage!, { metaKey: true, deltaY: 100 });
    await waitFor(() => {
      expect(within(previewDialog).getByLabelText("模板预览缩放比例")).toHaveTextContent("100%");
    });
  });

  it("可以通过预览工具栏放大和缩小模板", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    render(<ResumeTemplatesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "查看模板：经典单页技术简历" }));

    const previewDialog = screen.getByRole("dialog", { name: "经典单页技术简历" });
    const scale = within(previewDialog).getByLabelText("模板预览缩放比例");

    fireEvent.click(within(previewDialog).getByRole("button", { name: "放大模板" }));
    expect(scale).toHaveTextContent("110%");

    fireEvent.click(within(previewDialog).getByRole("button", { name: "缩小模板" }));
    expect(scale).toHaveTextContent("100%");
  });

  it("可以使用按钮和方向键循环切换相邻模板，并保留缩放比例", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    render(<ResumeTemplatesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "查看模板：现代双栏" }));

    let previewDialog = screen.getByRole("dialog", { name: "现代双栏" });
    fireEvent.click(within(previewDialog).getByRole("button", { name: "放大模板" }));
    fireEvent.click(within(previewDialog).getByRole("button", { name: "下一个模板：校园简历" }));

    previewDialog = screen.getByRole("dialog", { name: "校园简历" });
    expect(within(previewDialog).getByLabelText("模板预览缩放比例")).toHaveTextContent("110%");
    expect(within(previewDialog).getByRole("button", { name: "上一个模板：现代双栏" })).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: "下一个模板：经典单页技术简历" })).toBeInTheDocument();

    fireEvent.keyDown(previewDialog, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "经典单页技术简历" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "经典单页技术简历" }), { key: "ArrowLeft" });
    expect(screen.getByRole("dialog", { name: "校园简历" })).toBeInTheDocument();
  });

  it("预览里点取消只关闭预览，不进入命名弹窗", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    render(<ResumeTemplatesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "查看模板：经典单页技术简历" }));
    const previewDialog = screen.getByRole("dialog", { name: "经典单页技术简历" });
    expect(previewDialog).toHaveTextContent(/第 \d \/ 3 套/);
    fireEvent.click(within(previewDialog).getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("名称为空时留在弹窗并阻止创建", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    const createResume = vi.fn();
    useResumeStore.setState({ createResume });
    render(<ResumeTemplatesPage />);

    await openCreateFromPreview("经典单页技术简历");
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("请输入简历名称。");
    expect(alert).toHaveClass("v3-field-error");
    expect(createResume).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("创建失败时保留弹窗并显示明确错误", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    useResumeStore.setState({
      createResume: vi.fn().mockRejectedValue(new ApiRequestError(409, "RESUME_TITLE_CONFLICT")),
    });
    render(<ResumeTemplatesPage />);

    await openCreateFromPreview("经典单页技术简历");
    fireEvent.change(screen.getByLabelText("简历名称"), { target: { value: "重复名称" } });
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("该名称已经存在，请换一个名称。");
    expect(alert).toHaveClass("v3-field-error");
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
    const { container } = render(<ResumeTemplatesPage />);

    expect(await screen.findByRole("heading", { name: "当前没有可用模板" })).toBeInTheDocument();
    expect(container.querySelector(".v3-empty.tpl-empty.is-none")).toBeInTheDocument();
    expect(document.querySelector(".tpl-page .v3-page-eyebrow")).toHaveTextContent("TEMPLATES · 0 套");
    expect(screen.getByRole("link", { name: "返回全部简历" })).toHaveClass("v3-btn");
    fireEvent.click(screen.getByRole("link", { name: "返回全部简历" }));
    expect(window.location.pathname).toBe("/resumes");
  });
});

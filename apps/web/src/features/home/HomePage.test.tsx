import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  type ResumeImportSummary,
  type ResumeSummary,
} from "../../api/client";
import { defaultSettings, useResumeStore } from "../../store/resumeStore";
import { HomePage, HomeScreen } from "./HomePage";

const resumes: ResumeSummary[] = [
  {
    id: "1",
    title: "Frontend Resume",
    source_type: "template",
    lock_version: 1,
    created_at: "2026-07-20T08:00:00Z",
    updated_at: "2026-07-24T08:00:00Z",
  },
  {
    id: "2",
    title: "产品经理",
    source_type: "template",
    lock_version: 1,
    created_at: "2026-07-20T08:00:00Z",
    updated_at: "2026-07-23T08:00:00Z",
  },
];

function renderHome(overrides: Partial<React.ComponentProps<typeof HomeScreen>> = {}) {
  const props: React.ComponentProps<typeof HomeScreen> = {
    resumes,
    activeImports: [],
    failedImports: [],
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onDeleteImport: vi.fn(),
    ...overrides,
  };
  return { ...render(<HomeScreen {...props} />), props };
}

function openResumeMenu(title = "Frontend Resume") {
  fireEvent.click(screen.getByRole("button", { name: `更多简历操作 ${title}` }));
  return screen.getByRole("menu", { name: `${title} 操作菜单` });
}

describe("HomeScreen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/resumes");
  });

  it("首次读取时在页头下方展示统一加载状态", () => {
    const { container } = renderHome({ loading: true });

    expect(screen.getByRole("status", { name: "正在加载我的简历…" })).toBeInTheDocument();
    expect(container.querySelector(".home-dashboard-content > .page-loading")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-main")).not.toBeInTheDocument();
  });

  it("按名称筛选简历并从新建按钮在当前页打开创建弹窗", async () => {
    vi.spyOn(api, "listResumeTemplates").mockResolvedValue({ templates: [] });
    renderHome();

    expect(screen.queryByText(/按最近更新排列/)).not.toBeInTheDocument();
    expect(screen.queryByText(/点击简历卡片可继续编辑/)).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "搜索简历" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "搜索简历" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索简历" }), {
      target: { value: "frontend" },
    });
    expect(screen.getByText("Frontend Resume")).toBeInTheDocument();
    expect(screen.queryByText("产品经理")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清除并收起搜索" }));
    expect(screen.getByText("产品经理")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "搜索简历" })).not.toBeInTheDocument();

    const createButton = screen.getByRole("button", { name: "新建简历" });
    expect(createButton).toHaveClass("ui-button-transparent");
    fireEvent.click(createButton);
    expect(await screen.findByRole("dialog", { name: "新建简历" })).toBeInTheDocument();
    expect(screen.getByText("命名并选择一个起点，创建后直接进入编辑器。")).toBeInTheDocument();
    expect(screen.queryByText("导入文件")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/resumes");
  });

  it("导入简历入口在当前列表打开弹窗而不改变地址", async () => {
    vi.spyOn(api, "listResumeTemplates").mockResolvedValue({ templates: [] });
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: "导入简历" }));
    expect(await screen.findByRole("alertdialog", { name: "导入简历" })).toBeInTheDocument();
    expect(screen.queryByText("选择模板")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/resumes");
    expect(window.location.search).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog", { name: "导入简历" })).not.toBeInTheDocument();
  });

  it("通过站内确认弹窗删除正式简历", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderHome({ onDelete });
    fireEvent.click(within(openResumeMenu()).getByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("alertdialog", { name: "删除“Frontend Resume”？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("1"));
  });

  it("在卡片操作区重命名简历", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderHome({ onRename });

    fireEvent.click(within(openResumeMenu()).getByRole("menuitem", { name: "重命名" }));
    const dialog = screen.getByRole("dialog", { name: "重命名简历" });
    const input = within(dialog).getByLabelText("简历名称");
    expect(input).toHaveValue("Frontend Resume");

    fireEvent.change(input, { target: { value: "  前端工程师简历  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存名称" }));

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("1", "前端工程师简历"));
    expect(screen.queryByRole("dialog", { name: "重命名简历" })).not.toBeInTheDocument();
  });

  it("重命名失败时保留对话框并提示重试", async () => {
    const onRename = vi.fn().mockRejectedValue(new Error("VERSION_CONFLICT"));
    renderHome({ onRename });

    fireEvent.click(within(openResumeMenu()).getByRole("menuitem", { name: "重命名" }));
    const dialog = screen.getByRole("dialog", { name: "重命名简历" });
    fireEvent.change(within(dialog).getByLabelText("简历名称"), {
      target: { value: "新名称" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存名称" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("保存名称失败，请刷新列表后重试。");
    expect(dialog).toBeInTheDocument();
  });

  it("卡片底部只保留打开，其余操作收进右上角菜单", () => {
    renderHome();

    expect(screen.getAllByRole("button", { name: "打开" })).toHaveLength(2);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();

    const menu = openResumeMenu();
    expect(within(menu).getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "分享链接" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  });

  it("按 Escape 关闭操作菜单并将焦点还给三个点按钮", () => {
    renderHome();
    openResumeMenu();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更多简历操作 Frontend Resume" })).toHaveFocus();
  });

  it("失败导入卡显示失败阶段和耗时", () => {
    const failedImports: ResumeImportSummary[] = [
      {
        id: "31",
        source_filename: "upload.md",
        source_file_format: "md",
        upload_status: "failed",
        upload_duration_ms: 420,
        parse_status: null,
        parse_duration_ms: null,
        result_resume_id: null,
        created_at: "2026-08-08T08:00:00Z",
        updated_at: "2026-08-08T08:00:01Z",
      },
      {
        id: "32",
        source_filename: "parse.pdf",
        source_file_format: "pdf",
        upload_status: "succeeded",
        upload_duration_ms: 120,
        parse_status: "failed",
        parse_duration_ms: 1250,
        result_resume_id: null,
        created_at: "2026-08-08T08:00:00Z",
        updated_at: "2026-08-08T08:00:02Z",
      },
    ];

    renderHome({ failedImports });

    expect(screen.getAllByText("未完成")).toHaveLength(2);
    expect(screen.getByText("上传失败 · 420 毫秒")).toBeInTheDocument();
    expect(screen.getByText("解析失败 · 1.3 秒")).toBeInTheDocument();
  });

  it("处理中导入使用纵向预览卡和不可确定进度条", () => {
    const activeImport: ResumeImportSummary = {
      id: "41",
      source_filename: "张三-后端工程师.pdf",
      source_file_format: "pdf",
      upload_status: "succeeded",
      upload_duration_ms: 120,
      parse_status: "processing",
      parse_duration_ms: null,
      result_resume_id: null,
      created_at: "2026-08-08T08:00:00Z",
      updated_at: "2026-08-08T08:00:01Z",
    };

    renderHome({ activeImports: [activeImport] });

    const taskCard = screen.getByRole("article", {
      name: "导入任务 张三-后端工程师.pdf",
    });
    expect(taskCard).toHaveClass("home-import-card");
    expect(within(taskCard).getByText("未完成")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", {
      name: "张三-后端工程师.pdf 正在解析",
    })).toHaveAttribute("aria-valuetext", "正在解析，暂时无法估算完成时间");
    expect(screen.getByText("正在解析 · 请稍候")).toBeInTheDocument();
  });

  it("未完成导入和正式简历展示在同一个卡片网格", () => {
    const activeImport: ResumeImportSummary = {
      id: "41",
      source_filename: "后端工程师.pdf",
      source_file_format: "pdf",
      upload_status: "succeeded",
      upload_duration_ms: 120,
      parse_status: "processing",
      parse_duration_ms: null,
      result_resume_id: null,
      created_at: "2026-08-08T08:00:00Z",
      updated_at: "2026-08-08T08:00:01Z",
    };

    renderHome({ activeImports: [activeImport] });

    const cardGrid = screen.getByRole("region", { name: "全部简历" });
    expect(within(cardGrid).getByRole("article", {
      name: "导入任务 后端工程师.pdf",
    })).toBeInTheDocument();
    expect(within(cardGrid).getByText("Frontend Resume")).toBeInTheDocument();
    expect(screen.queryByText("全部 3")).not.toBeInTheDocument();
    expect(screen.queryByText("最近更新")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "导入任务" })).not.toBeInTheDocument();
  });

  it("失败记录删除失败时保留卡片并显示错误", async () => {
    const failedImport: ResumeImportSummary = {
      id: "31",
      source_filename: "resume.md",
      source_file_format: "md",
      upload_status: "failed",
      upload_duration_ms: null,
      parse_status: null,
      parse_duration_ms: null,
      result_resume_id: null,
      created_at: "2026-08-08T08:00:00Z",
      updated_at: "2026-08-08T08:00:01Z",
    };
    const onDeleteImport = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    renderHome({ failedImports: [failedImport], onDeleteImport });

    fireEvent.click(screen.getByRole("button", { name: "删除失败记录 resume.md" }));

    await waitFor(() => expect(onDeleteImport).toHaveBeenCalledWith("31"));
    expect(screen.getByText("resume.md")).toBeInTheDocument();
    expect(screen.getByText(/删除“resume.md”的失败记录失败/)).toBeInTheDocument();
  });
});

describe("HomePage import polling", () => {
  const processingTask = (id: string): ResumeImportSummary => ({
    id,
    source_filename: `张三-${id}.docx`,
    source_file_format: "docx",
    upload_status: "succeeded",
    upload_duration_ms: 20,
    parse_status: "processing",
    parse_duration_ms: null,
    result_resume_id: null,
    created_at: "2026-08-19T00:00:00Z",
    updated_at: "2026-08-19T00:00:00Z",
  });

  beforeEach(() => {
    vi.useFakeTimers();
    useResumeStore.setState({
      resumes: [],
      activeImports: [],
      failedImports: [],
      settings: defaultSettings,
      listResumes: vi.fn().mockResolvedValue(undefined),
      pollResumeImport: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("每秒分别轮询所有正在解析的任务，并在任务移除后停止对应轮询", async () => {
    const first = processingTask("41");
    const second = processingTask("42");
    const poll = vi.fn().mockResolvedValue(undefined);
    useResumeStore.setState({
      activeImports: [first, second],
      pollResumeImport: poll,
    });
    render(<HomePage />);

    expect(poll).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(poll.mock.calls).toEqual([["41"], ["42"]]);

    act(() => useResumeStore.setState({ activeImports: [second] }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(poll.mock.calls).toEqual([["41"], ["42"], ["42"]]);
  });

  it("上传中或非 processing 状态不触发轮询", async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    useResumeStore.setState({
      activeImports: [
        processingTask("51"),
        processingTask("52"),
      ].map((task, index) => (
        index === 0
          ? { ...task, upload_status: "uploading" as const, parse_status: null }
          : { ...task, parse_status: null }
      )),
      pollResumeImport: poll,
    });
    render(<HomePage />);

    await act(() => vi.advanceTimersByTimeAsync(2000));

    expect(poll).not.toHaveBeenCalled();
  });

  it("上一次状态请求未完成时跳过同一任务的后续 tick", async () => {
    let finishRequest!: () => void;
    const pendingRequest = new Promise<void>((resolve) => {
      finishRequest = resolve;
    });
    const poll = vi.fn().mockReturnValue(pendingRequest);
    useResumeStore.setState({
      activeImports: [processingTask("61")],
      pollResumeImport: poll,
    });
    render(<HomePage />);

    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => finishRequest());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(poll).toHaveBeenCalledTimes(2);
  });
});

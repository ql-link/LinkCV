import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  type ResumeImportSummary,
  type ResumeSummary,
} from "../../api/client";
import { defaultCanonicalDocument, defaultCanonicalPresentation } from "../../api/resumeContract";
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
  it("复制使用当前锁和稳定请求 ID，列表刷新失败不误报复制失败", async () => {
    const copied = { ...resumes[0], id: "copy-1", title: "独立简历", data: defaultCanonicalDocument, style: defaultCanonicalPresentation };
    const copy = vi.spyOn(api, "copyResume").mockResolvedValue({ resume: copied } as Awaited<ReturnType<typeof api.copyResume>>);
    vi.spyOn(useResumeStore.getState(), "listResumes").mockRejectedValue(new Error("NETWORK_ERROR"));
    renderHome();
    fireEvent.click(within(openResumeMenu()).getByRole("menuitem", { name: "复制为新简历" }));
    fireEvent.change(screen.getByLabelText("简历名称"), { target: { value: "独立简历" } });
    fireEvent.click(screen.getByRole("button", { name: "创建副本" }));
    await waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(copy).toHaveBeenCalledWith("1", { title: "独立简历", base_lock_version: 1, client_request_id: expect.any(String) });
    expect(await screen.findByText(/副本已创建/)).toBeInTheDocument();
    expect(useResumeStore.getState().resumes.some((item) => item.id === "copy-1")).toBe(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/resumes");
  });

  it("首次读取时保留页头并展示骨架卡片", () => {
    renderHome({ loading: true });

    expect(screen.getByRole("heading", { name: "我的简历" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "正在加载我的简历…" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "全部简历" })).not.toBeInTheDocument();
    expect(screen.queryByText(/RESUMES · \d+ 份/)).not.toBeInTheDocument();
  });

  it("无简历时展示空列表卡片，新建与导入都从卡片进入", () => {
    renderHome({ resumes: [] });
    const emptyState = screen.getByRole("region", { name: "还没有简历" });

    expect(within(emptyState).getByRole("heading", { name: "从第一份简历开始" })).toBeInTheDocument();
    expect(within(emptyState).getByRole("button", { name: "新建简历" })).toBeInTheDocument();
    expect(within(emptyState).getByRole("button", { name: "导入简历" })).toBeInTheDocument();
    expect(document.querySelector(".hv3-eyebrow")).toHaveTextContent("RESUMES · 0 份");
  });

  it("按名称筛选简历并从新建按钮在当前页打开创建弹窗", async () => {
    vi.spyOn(api, "listResumeTemplates").mockResolvedValue({ templates: [] });
    renderHome();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索简历" }), {
      target: { value: "frontend" },
    });
    expect(screen.getByText("Frontend Resume")).toBeInTheDocument();
    expect(screen.queryByText("产品经理")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索简历" }), { target: { value: "" } });
    expect(screen.getByText("产品经理")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新建简历" }));
    expect(await screen.findByRole("dialog", { name: "新建简历" })).toBeInTheDocument();
    expect(screen.getByText("选一套模板，再起个名字，创建后直接进入编辑器。")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/resumes");
  });

  it("搜索没有结果时只替换卡片区，并可一键清除搜索", () => {
    renderHome();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索简历" }), { target: { value: "滴滴" } });

    expect(screen.getByRole("heading", { name: "没有找到「滴滴」" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "我的简历" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(screen.getByText("Frontend Resume")).toBeInTheDocument();
  });

  it("达到 10 份上限时新建、导入、复制都置灰并说明原因", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ ...resumes[0], id: String(index + 1), title: `简历 ${index + 1}` }));
    renderHome({ resumes: many });

    expect(screen.getByText("已达到 10 份上限。删除不用的简历后，才能新建、导入或复制。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建简历" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导入简历" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "已达 10 份上限" })).toBeDisabled();
    const menu = openResumeMenu("简历 1");
    expect(within(menu).getByRole("menuitem", { name: "复制为新简历" })).toBeDisabled();
  });

  it("导入简历入口在当前列表打开弹窗而不改变地址", async () => {
    vi.spyOn(api, "listResumeTemplates").mockResolvedValue({ templates: [] });
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: "导入简历" }));
    expect(await screen.findByRole("dialog", { name: "导入简历" })).toBeInTheDocument();
    expect(screen.queryByText("选择模板")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/resumes");
    expect(window.location.search).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "导入简历" })).not.toBeInTheDocument();
  });

  it("通过站内确认弹窗删除正式简历", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderHome({ onDelete });
    fireEvent.click(within(openResumeMenu()).getByRole("menuitem", { name: "删除" }));
    const dialog = screen.getByRole("dialog", { name: "删除这份简历？" });
    expect(dialog).toHaveTextContent("Frontend Resume · 删除后无法恢复");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
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

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("保存名称失败，请刷新列表后重试。");
    expect(alert).toHaveClass("v3-toast");
    expect(dialog).not.toContainElement(alert);
    expect(dialog).toBeInTheDocument();
  });

  it("点击缩略图打开编辑器，其余操作收进右上角菜单", () => {
    const onOpen = vi.fn();
    renderHome({ onOpen });

    fireEvent.click(screen.getByRole("button", { name: "打开 Frontend Resume" }));
    expect(onOpen).toHaveBeenCalledWith("1");
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();

    const menu = openResumeMenu();
    for (const name of ["打开编辑", "重命名", "复制为新简历", "分享链接", "导出 PDF", "删除"]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
    }
  });

  it("重命名弹窗里可以转去复制为新简历", () => {
    renderHome();
    fireEvent.click(within(openResumeMenu()).getByRole("menuitem", { name: "重命名" }));
    fireEvent.click(screen.getByRole("button", { name: "复制为新简历" }));

    expect(screen.queryByRole("dialog", { name: "重命名简历" })).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "复制为新简历" });
    expect(within(dialog).getByLabelText("简历名称")).toHaveValue("Frontend Resume 副本");
  });

  it("摘要缺少服务端布局计划时显示受控不可用状态", () => {
    renderHome({
      resumes: [{
        ...resumes[0],
        preview: {
          data: defaultCanonicalDocument,
          style: defaultCanonicalPresentation,
          layout_plan: null,
        },
      }],
    });

    expect(screen.getByText("预览不可用")).toBeInTheDocument();
  });

  it("我的简历卡片按未启用智能一页的第一页预览", () => {
    const style = {
      ...defaultCanonicalPresentation,
      portable: { ...defaultCanonicalPresentation.portable, smart_one_page: true },
    };
    const { container } = renderHome({ resumes: [{
      ...resumes[0],
      preview: {
        data: defaultCanonicalDocument,
        style,
        layout_plan: {
          schema_version: "layout-plan.v1",
          content_sha256: `sha256:${"2".repeat(64)}`,
          template_key: "classic-cn",
          regions: [{ region_id: "main", order: 0, nodes: [{
            node_id: defaultCanonicalDocument.identity.node_id,
            semantic_kind: "identity",
            slot_id: "main_content",
          }] }],
        },
      },
    }] });
    expect(container.querySelector(".hv3-paper .resume-readonly-preview-first-page")).toBeInTheDocument();
    expect(container.querySelector(".hv3-paper .resume-paper")).not.toHaveClass("smart-one-page");
    expect(style.portable.smart_one_page).toBe(true);
  });

  it("按 Escape 关闭操作菜单并将焦点还给三个点按钮", () => {
    renderHome();
    openResumeMenu();

    fireEvent.keyDown(document, { key: "Escape" });

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

    expect(screen.getAllByText("上传失败").length).toBeGreaterThan(0);
    expect(screen.getAllByText("解析失败").length).toBeGreaterThan(0);
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
    expect(taskCard).toHaveClass("hv3-import-card");
    expect(within(taskCard).getByText("解析中")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", {
      name: "张三-后端工程师.pdf 正在解析",
    })).toHaveAttribute("aria-valuetext", "正在解析，暂时无法估算完成时间");
    expect(screen.getByText("正在解析 · 请稍候")).toBeInTheDocument();
  });

  it("导入任务和正式简历展示在同一个卡片网格", () => {
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

  it("列表加载失败时显示失败卡片，重新加载恢复空列表", async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error("NETWORK_ERROR")).mockResolvedValueOnce(undefined);
    useResumeStore.setState({ listResumes: list });
    render(<HomePage />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("alert")).toHaveTextContent("简历列表没能加载出来");
    expect(screen.queryByRole("region", { name: "还没有简历" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "还没有简历" })).toBeInTheDocument();
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

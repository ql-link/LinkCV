import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ResumeImportSummary,
  type ResumeSummary,
} from "../../api/client";
import { HomeScreen } from "./HomePage";

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
    onCreate: vi.fn(),
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

  it("按名称筛选简历并从新建按钮进入创建流程", () => {
    const onCreate = vi.fn();
    renderHome({ onCreate });

    fireEvent.change(screen.getByLabelText("搜索简历"), {
      target: { value: "frontend" },
    });
    expect(screen.getByText("Frontend Resume")).toBeInTheDocument();
    expect(screen.queryByText("产品经理")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建简历" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("导入简历入口跳转到新建页的导入模式", () => {
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: "导入简历" }));
    expect(window.location.pathname).toBe("/resumes/new");
    expect(window.location.search).toBe("?mode=import");
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
    expect(screen.getByText("全部 3")).toBeInTheDocument();
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

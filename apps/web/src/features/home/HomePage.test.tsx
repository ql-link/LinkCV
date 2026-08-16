import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    onDelete: vi.fn(),
    onCreate: vi.fn(),
    onDeleteImport: vi.fn(),
    ...overrides,
  };
  return { ...render(<HomeScreen {...props} />), props };
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
    fireEvent.click(screen.getByRole("button", { name: "删除简历 Frontend Resume" }));
    expect(screen.getByRole("alertdialog", { name: "删除“Frontend Resume”？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("1"));
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

    expect(screen.getByText("上传失败 · 420 毫秒")).toBeInTheDocument();
    expect(screen.getByText("解析失败 · 1.3 秒")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "删除记录" }));

    await waitFor(() => expect(onDeleteImport).toHaveBeenCalledWith("31"));
    expect(screen.getByText("resume.md")).toBeInTheDocument();
    expect(screen.getByText(/删除“resume.md”的失败记录失败/)).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  type ResumeImportSummary,
  type ResumeSummary,
} from "../../api/client";
import { HomeScreen } from "./HomePage";

vi.mock("./TemplatePicker", () => ({
  TemplatePicker: ({ onSelect }: { onSelect: (template: object) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          id: "8",
          key: "blank-cn",
          name: "空白简历",
          description: null,
          data: {},
          style: {},
        })
      }
    >
      选择空白模板
    </button>
  ),
}));

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
    onImport: vi.fn().mockResolvedValue("1"),
    onDeleteImport: vi.fn(),
    ...overrides,
  };
  return { ...render(<HomeScreen {...props} />), props };
}

describe("HomeScreen", () => {
  afterEach(() => vi.restoreAllMocks());

  it("按名称筛选简历并从新建按钮进入创建流程", () => {
    const onCreate = vi.fn();
    renderHome({ onCreate });

    fireEvent.change(screen.getByPlaceholderText("搜索简历"), {
      target: { value: "frontend" },
    });
    expect(screen.getByText("Frontend Resume")).toBeInTheDocument();
    expect(screen.queryByText("产品经理")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建简历" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("导入必须同时选择模板和文件，受理后显示后台解析提示", async () => {
    const onImport = vi.fn().mockResolvedValue("3");
    const onOpen = vi.fn();
    const file = new File(["# Zhang San"], "resume.md", { type: "text/markdown" });
    renderHome({ onImport, onOpen });

    fireEvent.click(screen.getByRole("button", { name: "导入简历" }));
    const submit = screen.getByRole("button", { name: "开始导入" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "选择空白模板" }));
    fireEvent.change(screen.getByLabelText(/选择 Markdown/), { target: { files: [file] } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(file, "8"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText("文件已上传，正在后台解析。")).toBeInTheDocument();
  });

  it("结构化模型未配置时在导入弹窗内显示具体错误", async () => {
    const onImport = vi.fn().mockRejectedValue(
      new ApiRequestError(503, "STRUCTURING_MODEL_UNAVAILABLE"),
    );
    const file = new File(["# 张三"], "张三简历.md", { type: "text/markdown" });
    renderHome({ onImport });

    fireEvent.click(screen.getByRole("button", { name: "导入简历" }));
    fireEvent.click(screen.getByRole("button", { name: "选择空白模板" }));
    fireEvent.change(screen.getByLabelText(/选择 Markdown/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("内容结构化模型未配置或凭据不可用，请联系管理员配置后重试。");
    expect(screen.getByRole("dialog", { name: "导入简历" })).toContainElement(error);
    expect(screen.getByText("张三简历.md")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始导入" })).toBeEnabled();
  });

  it("同步导入等待响应时显示处理中状态并防止关闭弹窗", async () => {
    let resolveImport: ((resumeId: string) => void) | undefined;
    const onImport = vi.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        resolveImport = resolve;
      }),
    );
    const file = new File(["# 张三"], "张三简历.md", { type: "text/markdown" });
    const onOpen = vi.fn();
    renderHome({ onImport, onOpen });

    fireEvent.click(screen.getByRole("button", { name: "导入简历" }));
    fireEvent.click(screen.getByRole("button", { name: "选择空白模板" }));
    fireEvent.change(screen.getByLabelText(/选择 Markdown/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    expect(screen.getByRole("button", { name: "正在导入…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();

    resolveImport?.("3");
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("未知导入错误会显示服务端错误码而不是无响应", async () => {
    const onImport = vi.fn().mockRejectedValue(new ApiRequestError(502, "IMPORT_PROVIDER_FAILED"));
    const file = new File(["# 张三"], "张三简历.md", { type: "text/markdown" });
    renderHome({ onImport });

    fireEvent.click(screen.getByRole("button", { name: "导入简历" }));
    fireEvent.click(screen.getByRole("button", { name: "选择空白模板" }));
    fireEvent.change(screen.getByLabelText(/选择 Markdown/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "导入失败（IMPORT_PROVIDER_FAILED），请稍后重试。",
    );
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

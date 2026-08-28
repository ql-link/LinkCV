import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { ResumeImportDialog } from "./ResumeImportDialog";

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

const templates = [
  { id: "8", key: "blank-cn", name: "空白简历", description: null, data: {}, style: {} },
  { id: "9", key: "classic-technical-cn", name: "经典单页技术简历", description: null, data: {}, style: {} },
];

describe("ResumeImportDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("选择文件后默认填写名称，并忽略已退役空白模板使用默认版式", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    const importResume = vi.fn().mockResolvedValue("task-1");
    useResumeStore.setState({ importResume });
    const onClose = vi.fn();
    const onAccepted = vi.fn();
    render(<ResumeImportDialog onClose={onClose} onAccepted={onAccepted} />);

    const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]');
    expect(overlay).toHaveClass("bg-[var(--scrim)]");
    expect(overlay).not.toHaveClass("bg-black/80");

    const file = new File(["# 张三"], "张三简历.md", { type: "text/markdown" });
    fireEvent.change(screen.getByLabelText("选择 Markdown、DOCX 或 PDF 文件"), {
      target: { files: [file] },
    });
    expect(screen.getByLabelText(/简历名称/)).toHaveValue("张三简历");

    fireEvent.change(screen.getByLabelText(/简历名称/), { target: { value: "产品经理定向简历" } });
    fireEvent.click(await screen.findByRole("button", { name: "导入并开始解析" }));

    await waitFor(() => expect(importResume).toHaveBeenCalledWith(file, "9", "产品经理定向简历"));
    expect(onAccepted).toHaveBeenCalledWith("产品经理定向简历");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("导入失败时保留弹窗、文件和可行动错误", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    useResumeStore.setState({
      importResume: vi.fn().mockRejectedValue(new ApiRequestError(503, "STRUCTURING_MODEL_UNAVAILABLE")),
    });
    const onClose = vi.fn();
    render(<ResumeImportDialog onClose={onClose} onAccepted={vi.fn()} />);

    const file = new File(["# 张三"], "resume.md", { type: "text/markdown" });
    fireEvent.change(screen.getByLabelText("选择 Markdown、DOCX 或 PDF 文件"), {
      target: { files: [file] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "导入并开始解析" }));

    expect(await screen.findByText("内容结构化模型未配置或凭据不可用，请联系管理员配置后重试。")).toBeInTheDocument();
    expect(screen.getByText("resume.md")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: "导入简历" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("支持把文件拖放到上传区域并自动填写名称", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates } as never);
    useResumeStore.setState({ importResume: vi.fn().mockResolvedValue("task-1") });
    render(<ResumeImportDialog onClose={vi.fn()} onAccepted={vi.fn()} />);

    const file = new File(["# 张三"], "拖放简历.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByLabelText("选择 Markdown、DOCX 或 PDF 文件"), {
      dataTransfer: { files: [file] },
    });

    expect(screen.getByText("拖放简历.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText(/简历名称/)).toHaveValue("拖放简历");
  });
});

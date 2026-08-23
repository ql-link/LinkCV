import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/client";
import {
  downloadPdfBlob,
  exportResumePdf,
  isResumePdfExportCancelled,
  resumePdfExportErrorMessage,
  resumePdfFilename,
  ResumePdfExportError,
} from "./pdfExport";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("resume PDF export orchestration", () => {
  it("保存完成后使用最新 lock_version 下载并释放 object URL", async () => {
    const saveCurrentResume = vi.fn().mockResolvedValue(undefined);
    const downloadResumePdf = vi.fn().mockResolvedValue({
      blob: new Blob(["pdf"]),
      filename: "张三-后端开发.pdf",
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:resume-pdf");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await exportResumePdf({
      resumeId: "resume-1",
      title: "未命名简历",
      saveCurrentResume,
      getSnapshot: () => ({ activeResumeId: "resume-1", lockVersion: 8, saveStatus: "saved" }),
      downloadResumePdf,
    });

    expect(saveCurrentResume).toHaveBeenCalledOnce();
    expect(downloadResumePdf).toHaveBeenCalledWith("resume-1", 8, undefined);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:resume-pdf");
    expect(document.querySelector("a")).not.toBeInTheDocument();
  });

  it("保存失败时不请求 PDF", async () => {
    const downloadResumePdf = vi.fn();

    await expect(exportResumePdf({
      resumeId: "resume-1",
      title: "简历",
      saveCurrentResume: vi.fn().mockResolvedValue(undefined),
      getSnapshot: () => ({ activeResumeId: "resume-1", lockVersion: 8, saveStatus: "error" }),
      downloadResumePdf,
    })).rejects.toMatchObject({ code: "RESUME_SAVE_FAILED" });

    expect(downloadResumePdf).not.toHaveBeenCalled();
  });

  it("导出前取消时不触发保存和下载", async () => {
    const controller = new AbortController();
    controller.abort();
    const saveCurrentResume = vi.fn();

    await expect(exportResumePdf({
      resumeId: "resume-1",
      title: "简历",
      saveCurrentResume,
      getSnapshot: () => ({ activeResumeId: "resume-1", lockVersion: 8, saveStatus: "saved" }),
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "RESUME_EXPORT_CANCELLED" });

    expect(saveCurrentResume).not.toHaveBeenCalled();
  });
});

describe("resume PDF export errors and filenames", () => {
  it("优先使用服务端文件名并清理本地下载名", () => {
    expect(resumePdfFilename("张三/投递版", "简历")).toBe("张三_投递版.pdf");
    expect(resumePdfFilename(null, "  我的简历  ")).toBe("我的简历.pdf");
    expect(resumePdfFilename("final.PDF", "简历")).toBe("final.PDF");
  });

  it("把稳定服务端错误映射为可重试提示", () => {
    expect(resumePdfExportErrorMessage(new ApiRequestError(409, "RESUME_PDF_SNAPSHOT_STALE")))
      .toBe("简历内容已变化，请重新导出");
    expect(resumePdfExportErrorMessage(new ApiRequestError(503, "RESUME_PDF_BUSY")))
      .toBe("PDF 服务暂时不可用，请稍后重试");
    expect(resumePdfExportErrorMessage(new ResumePdfExportError("RESUME_SAVE_FAILED")))
      .toBe("简历保存失败，请修正后重试");
  });

  it("释放下载 URL，即使锚点点击抛出异常", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:failed-pdf");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("download blocked");
    });

    expect(() => downloadPdfBlob(new Blob(["pdf"]), "简历.pdf")).toThrow("download blocked");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:failed-pdf");
    expect(isResumePdfExportCancelled(new DOMException("cancelled", "AbortError"))).toBe(true);
  });
});

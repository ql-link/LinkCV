import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { exportResumePdf, getStandardPdfPageCount } from "./exportPdf";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("getStandardPdfPageCount", () => {
  it("短内容至少导出一页", () => {
    expect(getStandardPdfPageCount(2100, 1200)).toBe(1);
  });

  it("按 A4 比例把长内容拆成多页且不截断末尾", () => {
    expect(getStandardPdfPageCount(2100, 5940)).toBe(2);
    expect(getStandardPdfPageCount(2100, 5941)).toBe(3);
  });

  it("没有可导出内容时记录失败审计且保持原有无抛错行为", async () => {
    const report = vi.spyOn(api, "reportAuditEvent").mockResolvedValue({
      accepted: true,
      eventId: "event-1",
    });

    await expect(exportResumePdf(false, "测试简历", "42")).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith({
      action: "resume.pdf_export",
      targetId: "42",
      result: "failed",
      errorCode: "PDF_EXPORT_CONTENT_MISSING",
    });
  });
});

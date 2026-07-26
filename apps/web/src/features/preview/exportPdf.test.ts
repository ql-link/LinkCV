import { describe, expect, it } from "vitest";
import { getStandardPdfPageCount } from "./exportPdf";

describe("getStandardPdfPageCount", () => {
  it("短内容至少导出一页", () => {
    expect(getStandardPdfPageCount(2100, 1200)).toBe(1);
  });

  it("按 A4 比例把长内容拆成多页且不截断末尾", () => {
    expect(getStandardPdfPageCount(2100, 5940)).toBe(2);
    expect(getStandardPdfPageCount(2100, 5941)).toBe(3);
  });
});

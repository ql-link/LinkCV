import { describe, expect, it } from "vitest";
import {
  A4_MIN_HEIGHT_MM,
  CSS_PX_TO_MM,
  smartPageHeightMm,
} from "./resumePrintReady";

describe("统一打印文档的页面测量", () => {
  it("按 96dpi 把内容高度换算为至少 A4 的智能页面", () => {
    expect(CSS_PX_TO_MM).toBeCloseTo(25.4 / 96);
    expect(smartPageHeightMm(0, 16, 16)).toBe(A4_MIN_HEIGHT_MM);
    expect(smartPageHeightMm(1122, 16, 16)).toBeGreaterThan(A4_MIN_HEIGHT_MM);
  });

  it("超过安全高度时拒绝生成页面", () => {
    expect(() => smartPageHeightMm(100000, 16, 16, 2000)).toThrow("PDF_RENDER_PAGE_TOO_TALL");
    expect(() => smartPageHeightMm(Number.NaN)).toThrow("PDF_RENDER_LAYOUT_MEASUREMENT_FAILED");
  });
});

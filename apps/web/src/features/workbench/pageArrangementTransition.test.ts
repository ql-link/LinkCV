import { describe, expect, it } from "vitest";
import {
  capturePageViewportAnchor,
  restorePageViewportAnchor,
  type PageViewportMetrics,
} from "./pageArrangementTransition";

const pageWidth = (210 / 25.4) * 96;
const pageHeight = (297 / 25.4) * 96;

function metrics(overrides: Partial<PageViewportMetrics> = {}): PageViewportMetrics {
  return {
    arrangement: "vertical",
    scale: 1,
    pageCount: 4,
    clientWidth: 1200,
    clientHeight: 800,
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 1200,
    scrollHeight: pageHeight * 4 + 24 * 3 + 160,
    paperLeft: 200,
    paperTop: 40,
    ...overrides,
  };
}

describe("页面排列切换锚点", () => {
  it("从纵向页面中段切到横向后保持同一页和页内高度", () => {
    const vertical = metrics({
      scrollTop: 40 + (pageHeight + 24) * 2 + pageHeight * 0.42 - 400,
    });
    const anchor = capturePageViewportAnchor(vertical);
    expect(anchor.pageIndex).toBe(2);
    expect(anchor.withinPageY).toBeCloseTo(0.42, 4);

    const horizontal = metrics({
      arrangement: "horizontal",
      scale: 0.8,
      clientWidth: 1280,
      clientHeight: 720,
      scrollWidth: (pageWidth * 4 + 24 * 3) * 0.8 + 96,
      scrollHeight: pageHeight * 0.8 + 160,
      paperLeft: 48,
      paperTop: 40,
    });
    const restored = restorePageViewportAnchor(horizontal, anchor);
    expect(restored.left).toBeGreaterThan(0);
    expect(restored.top).toBeCloseTo(40 + pageHeight * 0.8 * 0.42 - 360, 4);
  });

  it("横向双页完整可见时把水平位置安全限制在零", () => {
    const horizontal = metrics({
      arrangement: "horizontal",
      scale: 0.85,
      pageCount: 2,
      clientWidth: 1470,
      clientHeight: 900,
      scrollWidth: 1470,
      scrollHeight: pageHeight * 0.85 + 160,
      paperLeft: 48,
      paperTop: 40,
    });
    expect(restorePageViewportAnchor(horizontal, { pageIndex: 1, withinPageY: 0.5 }).left).toBe(0);
  });

  it("视口中心落在双页空隙时沿用切换前的当前页", () => {
    const horizontal = metrics({
      arrangement: "horizontal",
      scale: 0.8526,
      pageCount: 2,
      clientWidth: 1470,
      clientHeight: 851,
      scrollWidth: 1470,
      scrollHeight: 1093,
      paperLeft: 48.0625,
      paperTop: 40,
      scrollTop: 93,
    });
    expect(capturePageViewportAnchor(horizontal, 0).pageIndex).toBe(0);
    expect(capturePageViewportAnchor(horizontal, 1).pageIndex).toBe(1);
  });

  it("从横向切回纵向时按页码恢复到对应页面", () => {
    const horizontal = metrics({
      arrangement: "horizontal",
      scale: 0.75,
      scrollLeft: (pageWidth + 24) * 0.75,
      clientWidth: pageWidth * 0.75,
      clientHeight: 700,
      scrollWidth: (pageWidth * 4 + 24 * 3) * 0.75 + 96,
      scrollHeight: pageHeight * 0.75 + 120,
      paperLeft: 48,
      paperTop: 40,
    });
    const anchor = capturePageViewportAnchor(horizontal);
    expect(anchor.pageIndex).toBe(1);

    const restored = restorePageViewportAnchor(metrics(), anchor);
    expect(restored.top).toBeGreaterThan(pageHeight);
  });
});

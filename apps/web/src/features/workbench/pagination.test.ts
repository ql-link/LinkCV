import { describe, expect, it } from "vitest";
import { computePageBreaks, pageContentHeight } from "./pagination";

describe("computePageBreaks", () => {
  it("内容恰好一页时不产生分页", () => {
    expect(computePageBreaks([{ position: 1, top: 0, height: 100 }], 100)).toEqual([]);
  });

  it("把跨页块整体推到下一页", () => {
    expect(computePageBreaks([
      { position: 1, top: 0, height: 70 },
      { position: 8, top: 70, height: 40 },
    ], 100)).toEqual([{
      position: 8,
      page: 2,
      contentOffset: 70,
      remainingContentHeight: 30,
    }]);
  });

  it("允许单个超高块溢出并让后续块从下一页继续", () => {
    expect(computePageBreaks([
      { position: 1, top: 0, height: 140 },
      { position: 12, top: 140, height: 20 },
    ], 100)).toEqual([{
      position: 12,
      page: 2,
      contentOffset: 140,
      remainingContentHeight: 0,
    }]);
  });

  it("允许超高分点按文本行跨页并保留续排缩进信息", () => {
    expect(computePageBreaks([
      { position: 2, top: 0, height: 45, continuation: true, inlineOffset: 32 },
      { position: 8, top: 45, height: 45, continuation: true, inlineOffset: 32 },
      { position: 14, top: 90, height: 25, continuation: true, inlineOffset: 32 },
      { position: 20, top: 115, height: 45, continuation: true, inlineOffset: 32 },
      { position: 26, top: 160, height: 45, continuation: true, inlineOffset: 32 },
    ], 100)).toEqual([
      {
        position: 14,
        page: 2,
        contentOffset: 90,
        remainingContentHeight: 10,
        continuation: true,
        inlineOffset: 32,
      },
      {
        position: 26,
        page: 3,
        contentOffset: 160,
        remainingContentHeight: 30,
        continuation: true,
        inlineOffset: 32,
      },
    ]);
  });

  it("普通多行分点跨页时从下一行续排，而不是整体后移", () => {
    expect(computePageBreaks([
      { position: 1, top: 0, height: 50 },
      { position: 10, top: 50, height: 20 },
      { position: 16, top: 70, height: 20, continuation: true, inlineOffset: 28 },
      { position: 22, top: 90, height: 20, continuation: true, inlineOffset: 28 },
      { position: 28, top: 110, height: 20, continuation: true, inlineOffset: 28 },
    ], 100)).toEqual([{
      position: 22,
      page: 2,
      contentOffset: 90,
      remainingContentHeight: 10,
      continuation: true,
      inlineOffset: 28,
    }]);
  });

  it("根据 A4 高度扣除上下边距", () => {
    expect(pageContentHeight(20)).toBeCloseTo((257 / 25.4) * 96, 5);
  });
});

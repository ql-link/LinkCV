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
      remainingContentHeight: -40,
    }]);
  });

  it("保留页尾间距超出的高度，避免后一页逐页下移", () => {
    expect(computePageBreaks([
      { position: 1, top: 0, height: 96 },
      { position: 8, top: 106, height: 15 },
    ], 100)).toEqual([{
      position: 8,
      page: 2,
      contentOffset: 106,
      remainingContentHeight: -6,
    }]);
  });

  it("文字贴近页尾时提前分页，避免被页面裁切半行", () => {
    expect(computePageBreaks([
      { position: 1, top: 0, height: 80 },
      { position: 8, top: 81, height: 17 },
    ], 100)).toEqual([{
      position: 8,
      page: 2,
      contentOffset: 81,
      remainingContentHeight: 19,
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
    expect(pageContentHeight(8, 10)).toBeCloseTo((279 / 25.4) * 96, 5);
  });

  it("章节标题与紧随内容放不下时从标题前分页", () => {
    expect(computePageBreaks([
      { position: 1, top: 0, height: 75 },
      { position: 10, top: 75, height: 15, keepWithNext: true },
      { position: 20, top: 90, height: 30 },
    ], 100)).toEqual([{
      position: 10,
      page: 2,
      contentOffset: 75,
      remainingContentHeight: 25,
    }]);
  });

  it("并行双栏占用整页后，根层后续章节沿物理页继续分页", () => {
    expect(computePageBreaks([
      { position: 1, top: 0, height: 60 },
      { position: 10, top: 170, height: 15, keepWithNext: true },
      { position: 20, top: 185, height: 30 },
      { position: 30, top: 215, height: 30 },
    ], 100, 120)).toEqual([{
      position: 30,
      page: 3,
      contentOffset: 215,
      remainingContentHeight: 5,
    }]);
  });

  it("章节标题和空副标题之后的经历行一起换页", () => {
    expect(computePageBreaks([
      { position: 1, top: 930, height: 23, keepWithNext: true },
      { position: 5, top: 963, height: 17, keepWithNext: true },
      { position: 9, top: 982, height: 45 },
    ], 1000)).toEqual([{
      position: 1,
      page: 2,
      contentOffset: 930,
      remainingContentHeight: 70,
    }]);
  });
});

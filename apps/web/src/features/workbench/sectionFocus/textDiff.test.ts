import { describe, expect, it } from "vitest";
import { addedRanges, diffText } from "./textDiff";

describe("diffText", () => {
  it("marks deleted and added runs", () => {
    expect(diffText("负责配送服务改造", "主导配送服务改造")).toEqual([
      { kind: "del", text: "负责" },
      { kind: "add", text: "主导" },
      { kind: "same", text: "配送服务改造" },
    ]);
  });

  it("returns a single run for identical text", () => {
    expect(diffText("不变", "不变")).toEqual([{ kind: "same", text: "不变" }]);
  });
});

describe("addedRanges", () => {
  it("returns offsets of added text inside the new line", () => {
    const after = "拆分 12 个单体模块";
    const ranges = addedRanges("拆分单体模块", after);
    expect(ranges.map(([start, end]) => after.slice(start, end))).toEqual([" 12 个"]);
  });
});

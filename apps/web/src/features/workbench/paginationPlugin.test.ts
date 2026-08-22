import { describe, expect, it } from "vitest";
import { paginationCandidates, paginationMutationRequiresMeasure } from "./paginationPlugin";

describe("分页测量触发条件", () => {
  it("忽略页面排列类名和分页插件内部尺寸变量", () => {
    expect(paginationMutationRequiresMeasure(
      "class",
      "resume-paper theme-classic",
      "resume-paper theme-classic pages-horizontal",
    )).toBe(false);
    expect(paginationMutationRequiresMeasure(
      "style",
      "--resume-font-size: 11pt; --resume-page-count: 2;",
      "--resume-font-size: 11pt; --resume-page-count: 5; --resume-page-strip-width: 4000px;",
    )).toBe(false);
  });

  it("正文排版相关样式或模式类名变化后重新测量", () => {
    expect(paginationMutationRequiresMeasure(
      "style",
      "--resume-font-size: 11pt; --resume-page-margin-y: 16mm;",
      "--resume-font-size: 12pt; --resume-page-margin-y: 16mm;",
    )).toBe(true);
    expect(paginationMutationRequiresMeasure(
      "class",
      "resume-paper theme-classic",
      "resume-paper theme-classic smart-one-page",
    )).toBe(true);
  });

  it("分页测量排除分页装饰并展开列表项", () => {
    const editor = document.createElement("div");
    editor.innerHTML = [
      '<h2>目标标题</h2>',
      '<ul><li>第一分点</li><li>第二分点</li></ul>',
      '<div class="workbench-page-break"></div>',
    ].join("");

    expect(paginationCandidates(editor).map((element) => element.textContent)).toEqual(["目标标题", "第一分点", "第二分点"]);
  });
});

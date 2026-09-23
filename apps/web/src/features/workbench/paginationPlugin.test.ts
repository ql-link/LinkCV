import { describe, expect, it } from "vitest";
import { paginationCandidates, paginationMutationRequiresMeasure, paginationTextNodes } from "./paginationPlugin";

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

  it("双栏内容按栏展开，避免把整组作为一个超高块", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<div class="resume-layout-columns"><section class="resume-layout-column"><h2>左栏</h2><p>左侧内容</p></section><section class="resume-layout-column"><h2>右栏</h2><ul><li>右侧分点</li></ul></section></div>';
    expect(paginationCandidates(editor).map((element) => element.textContent)).toEqual([
      "左栏", "左侧内容", "右栏", "右侧分点",
    ]);
  });

  it("测量列表正文时不把行首按钮和分页占位当作文字", () => {
    const item = document.createElement("li");
    item.innerHTML = '<p><button class="resume-line-add">+</button>完整正文<span class="workbench-page-break">忽略</span>续排</p>';
    expect(paginationTextNodes(item).map((node) => node.textContent)).toEqual(["完整正文", "续排"]);
  });
});

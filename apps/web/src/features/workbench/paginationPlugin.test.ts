import { describe, expect, it } from "vitest";
import { paginationCandidates, paginationMutationRequiresMeasure, paginationTextNodes, paginationTrailingEmptyParagraphs } from "./paginationPlugin";

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

  it("忽略每栏及根层末尾的空段落，但保留内容之间的空行", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<div class="resume-layout-columns"><section class="resume-layout-column"><p>左一</p><p></p><p>左二</p><p><button class="resume-line-add">+</button><img class="ProseMirror-separator" alt=""><br></p></section><section class="resume-layout-column"><p>右侧</p><p><br></p></section></div><p>尾部正文</p><p></p>';

    expect(paginationCandidates(editor).map((element) => element.textContent)).toEqual([
      "左一", "", "左二", "右侧", "尾部正文",
    ]);
  });

  it("保留末尾仅含图标或图片的段落", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<p>正文</p><p><span class="resume-inline-icon"></span></p><p><img src="data:image/png;base64,AA==" alt="示意图"></p><p><br></p>';

    expect(paginationCandidates(editor)).toHaveLength(3);
  });

  it("仅标出每栏及根层末尾的空段落，不折叠正文间空行或媒体", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<div class="resume-layout-columns"><section class="resume-layout-column"><p>正文</p><p><br></p><p>下一段</p><p><button class="resume-line-add">+</button><br></p><p><br></p></section><section class="resume-layout-column"><p>头像<img src="sample.png" alt="示意图"></p><p><br></p></section></div><p>根层正文</p><p><br></p>';

    expect(paginationTrailingEmptyParagraphs(editor)).toEqual([
      editor.lastElementChild,
      editor.querySelectorAll(".resume-layout-column:first-child > p")[4],
      editor.querySelectorAll(".resume-layout-column:first-child > p")[3],
      editor.querySelector(".resume-layout-column:last-child > p:last-child"),
    ]);
  });

  it("测量列表正文时不把行首按钮和分页占位当作文字", () => {
    const item = document.createElement("li");
    item.innerHTML = '<p><button class="resume-line-add">+</button>完整正文<span class="workbench-page-break">忽略</span>续排</p>';
    expect(paginationTextNodes(item).map((node) => node.textContent)).toEqual(["完整正文", "续排"]);
  });
});

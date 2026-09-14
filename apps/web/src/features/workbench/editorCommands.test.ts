import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  convertCurrentLineToResumeRow,
  convertResumeRowToParagraph,
  exitVisuallyBlankResumeListItem,
  removeBlankParagraphAfterResumeRow,
  removeVisuallyBlankResumeLine,
} from "./editorCommands";
import { normalizeResumeRowWidth, resumeEditorExtensions, resumeRowWidthFromClientX } from "./editorExtensions";
import { renderResumeMarkdown } from "../../parser/resumeMarkdown";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function visualStartOfTextblock(targetEditor: Editor, typeName: string, occurrence = 0) {
  let currentOccurrence = 0;
  let targetPosition: number | null = null;
  targetEditor.state.doc.descendants((node, position) => {
    if (targetPosition !== null || node.type.name !== typeName || !node.isTextblock) return;
    if (currentOccurrence !== occurrence) {
      currentOccurrence += 1;
      return;
    }
    const anchorSize = node.firstChild?.type.name === "resumeBlockAnchor"
      ? node.firstChild.nodeSize
      : 0;
    targetPosition = position + 1 + anchorSize;
  });
  if (targetPosition === null) throw new Error(`未找到第 ${occurrence + 1} 个 ${typeName}`);
  return targetPosition;
}

describe("convertCurrentLineToResumeRow", () => {
  it("保留当前行内容并创建可独立编辑的右栏", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "星河云科技" }] }] },
    });
    editor.commands.setTextSelection(3);

    expect(convertCurrentLineToResumeRow(editor)).toBe(true);
    const row = editor.getJSON().content?.[0];
    expect(row).toMatchObject({ type: "resumeRow", attrs: { leftWidth: 50 } });
    expect(row?.content?.[0]?.content).toEqual(expect.arrayContaining([
      { type: "text", text: "星河云科技" },
    ]));
    expect(row?.content?.[1]).toMatchObject({ type: "paragraph" });
    expect(editor.isActive("resumeRow")).toBe(true);
    expect(editor.state.selection.$from.parent).toEqual(editor.state.doc.firstChild?.child(1));
    expect(editor.state.selection.$from.parentOffset).toBe(1);
  });

  it("空白行转换后先在左栏输入并显示右栏入口", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p></p>" });
    editor.commands.setTextSelection(1);

    expect(convertCurrentLineToResumeRow(editor)).toBe(true);
    expect(editor.state.selection.$from.parent).toEqual(editor.state.doc.firstChild?.child(0));
    expect(editor.state.selection.$from.parentOffset).toBe(0);
  });

  it("光标已经在左右行内时不会再次嵌套", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: "resumeRow",
          attrs: { leftWidth: 60 },
          content: [{ type: "paragraph", content: [{ type: "text", text: "左" }] }, { type: "paragraph", content: [{ type: "text", text: "右" }] }],
        }],
      },
    });
    editor.commands.setTextSelection(3);

    expect(convertCurrentLineToResumeRow(editor)).toBe(false);
    expect(editor.getJSON().content?.[0].attrs?.leftWidth).toBe(60);
  });

  it("不会把列表项转换成破坏列表结构的左右行", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: "bulletList",
          content: [{
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "列表项" }] }],
          }],
        }],
      },
    });
    editor.commands.setTextSelection(3);

    expect(convertCurrentLineToResumeRow(editor)).toBe(false);
    expect(editor.getJSON().content?.[0].type).toBe("bulletList");
  });

  it("可以恢复普通行且不丢失左右文字", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: "resumeRow",
          content: [{ type: "paragraph", content: [{ type: "text", text: "公司" }] }, { type: "paragraph", content: [{ type: "text", text: "职位" }] }],
        }],
      },
    });
    editor.commands.setTextSelection(3);

    expect(convertResumeRowToParagraph(editor)).toBe(true);
    expect(editor.getText()).toBe("公司　职位");
    expect(editor.getJSON().content?.[0].type).toBe("paragraph");
  });

  it("旧 Markdown 的左右块会迁移为 resumeRow", () => {
    const html = renderResumeMarkdown("::: left\n示例大学\n:::\n::: right\n2022 – 2026\n:::");
    editor = new Editor({ extensions: resumeEditorExtensions, content: html });

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "resumeRow",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "示例大学" }] },
        { type: "paragraph", content: [{ type: "text", text: "2022 – 2026" }] },
      ],
    });
  });

  it("左右分栏内按 Enter 会退出分栏并进入后续空白行", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: "resumeRow",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "左栏" }] },
            { type: "paragraph", content: [{ type: "text", text: "右栏" }] },
          ],
        }],
      },
    });
    editor.commands.setTextSelection(4);

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(editor.getJSON().content).toMatchObject([
      { type: "resumeRow" },
      { type: "paragraph" },
    ]);
    expect(editor.state.selection.$from.parent).toEqual(editor.state.doc.child(1));
    expect(editor.state.selection.$from.parentOffset).toBe(1);
  });

  it("分栏后已有空白行时按 Enter 不会重复插入", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [
          {
            type: "resumeRow",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "左栏" }] },
              { type: "paragraph", content: [{ type: "text", text: "右栏" }] },
            ],
          },
          { type: "paragraph" },
        ],
      },
    });
    editor.commands.setTextSelection(8);

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(editor.getJSON().content).toHaveLength(2);
    expect(editor.state.selection.$from.parent).toEqual(editor.state.doc.child(1));
  });

  it("分栏退出后的空白行可以按 Backspace 删除并回到右栏", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: "resumeRow",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "左栏" }] },
            { type: "paragraph", content: [{ type: "text", text: "右栏" }] },
          ],
        }],
      },
    });
    editor.commands.setTextSelection(4);
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

    expect(editor.getJSON().content).toHaveLength(1);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "resumeRow" });
    expect(editor.state.selection.$from.parent).toEqual(editor.state.doc.firstChild?.child(1));
    expect(editor.state.doc.firstChild?.textContent).toBe("左栏右栏");
  });

  it("不会把分栏后的非空正文误判成可删除空行", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [
          {
            type: "resumeRow",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "左栏" }] },
              { type: "paragraph", content: [{ type: "text", text: "右栏" }] },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "需要保留" }] },
        ],
      },
    });
    const rowSize = editor.state.doc.firstChild?.nodeSize ?? 0;
    editor.commands.setTextSelection(rowSize + 2);

    expect(removeBlankParagraphAfterResumeRow(editor)).toBe(false);
    expect(editor.getJSON().content).toHaveLength(2);
    expect(editor.state.doc.child(1).textContent).toBe("需要保留");
  });

  it("通过加号设置的空标题可以直接按 Backspace 删除", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "上一行" }] },
          { type: "heading", attrs: { level: 2 } },
          { type: "paragraph", content: [{ type: "text", text: "下一行" }] },
        ],
      },
    });
    editor.commands.setTextSelection(visualStartOfTextblock(editor, "heading"));

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
    expect(editor.getText()).toContain("上一行");
    expect(editor.getText()).toContain("下一行");
  });

  it.each(["bulletList", "orderedList"])("%s 的空列表项按 Backspace 后保留无标号的空白行", (listType) => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: listType,
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "保留项" }] }] },
            { type: "listItem", content: [{ type: "paragraph" }] },
          ],
        }],
      },
    });
    editor.commands.setTextSelection(visualStartOfTextblock(editor, "paragraph", 1));

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

    const list = editor.state.doc.firstChild;
    expect(list?.type.name).toBe(listType);
    expect(list?.childCount).toBe(1);
    expect(list?.textContent).toBe("保留项");
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.lastChild?.textContent).toBe("");
    expect(editor.state.selection.$from.parent).toBe(editor.state.doc.lastChild);
    expect(editor.isActive("listItem")).toBe(false);

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.textContent).toBe("保留项");
    expect(editor.state.selection.$from.parent.textContent).toBe("保留项");
  });

  it.each([
    ["bulletList", "Backspace"],
    ["orderedList", "Backspace"],
    ["bulletList", "Enter"],
    ["orderedList", "Enter"],
  ])("%s 回车续项后按 %s 退出列表并可在新行输入正文", (listType, exitKey) => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: listType,
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "保留项" }] }] }],
        }],
      },
    });
    editor.commands.setTextSelection(visualStartOfTextblock(editor, "paragraph"));
    editor.commands.setTextSelection(editor.state.selection.$from.end());
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    expect(editor.isActive("listItem")).toBe(true);
    expect(editor.state.selection.$from.parent.textContent).toBe("");

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: exitKey, bubbles: true, cancelable: true }));

    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.firstChild?.type.name).toBe(listType);
    expect(editor.state.doc.firstChild?.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.textContent).toBe("保留项");
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.lastChild?.textContent).toBe("");
    expect(editor.state.selection.$from.parent).toBe(editor.state.doc.lastChild);
    expect(editor.isActive("listItem")).toBe(false);

    editor.commands.insertContent("新的正文");

    expect(editor.state.doc.lastChild?.textContent).toBe("新的正文");
    expect(editor.state.doc.firstChild?.textContent).toBe("保留项");
  });

  it.each(["ul", "ol"])("%s 中间的空列表项退出后保留前后列表内容", (tag) => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: `<${tag}><li><p>前一项</p></li><li><p></p></li><li><p>后一项</p></li></${tag}>`,
    });
    editor.commands.setTextSelection(visualStartOfTextblock(editor, "paragraph", 1));

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

    const listType = tag === "ul" ? "bulletList" : "orderedList";
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([listType, "paragraph", listType]);
    expect(editor.state.doc.firstChild?.textContent).toBe("前一项");
    expect(editor.state.doc.lastChild?.textContent).toBe("后一项");
    expect(editor.state.selection.$from.parent).toBe(editor.state.doc.child(1));
    expect(editor.state.selection.$from.parent.textContent).toBe("");
  });

  it.each(["ul", "ol"])("%s 唯一的空项退出后保留原位置的空白行", (tag) => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: `<p>上一行</p><${tag}><li><p></p></li></${tag}><p>下一行</p>`,
    });
    editor.commands.setTextSelection(visualStartOfTextblock(editor, "paragraph", 1));

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(editor.state.doc.firstChild?.textContent).toBe("上一行");
    expect(editor.state.doc.lastChild?.textContent).toBe("下一行");
    expect(editor.state.selection.$from.parent).toBe(editor.state.doc.child(1));
    expect(editor.state.selection.$from.parent.textContent).toBe("");
  });

  it.each(["Backspace", "Enter"])("嵌套空列表项按 %s 逐层退出并保留正文", (key) => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: "<ul><li><p>父项</p><ol><li><p></p></li></ol></li></ul>",
    });
    editor.commands.setTextSelection(visualStartOfTextblock(editor, "paragraph", 1));

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

    expect(editor.state.doc.firstChild?.type.name).toBe("bulletList");
    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.textContent).toBe("父项");
    expect(editor.state.selection.$from.depth).toBe(3);

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.firstChild?.textContent).toBe("父项");
    expect(editor.state.selection.$from.parent).toBe(editor.state.doc.lastChild);
    expect(editor.state.selection.$from.parent.textContent).toBe("");
    expect(editor.isActive("listItem")).toBe(false);
  });

  it("空首段之后仍有嵌套正文时不会误判为空列表项", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: "<ul><li><p></p><ul><li><p>子项正文</p></li></ul></li></ul>",
    });
    editor.commands.setTextSelection(visualStartOfTextblock(editor, "paragraph"));
    const before = editor.getJSON();

    expect(exitVisuallyBlankResumeListItem(editor)).toBe(false);
    expect(removeVisuallyBlankResumeLine(editor)).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });

  it("完全清空的左右分栏可以直接按 Backspace 删除", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [
          {
            type: "resumeRow",
            content: [{ type: "paragraph" }, { type: "paragraph" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "保留正文" }] },
        ],
      },
    });
    editor.commands.setTextSelection(visualStartOfTextblock(editor, "paragraph"));

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

    expect(editor.getJSON().content).toHaveLength(1);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.firstChild?.textContent).toBe("保留正文");
  });

  it("左右分栏另一侧仍有内容时不会误删整行", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: "resumeRow",
          content: [
            { type: "paragraph" },
            { type: "paragraph", content: [{ type: "text", text: "右侧内容" }] },
          ],
        }],
      },
    });
    editor.commands.setTextSelection(visualStartOfTextblock(editor, "paragraph"));

    expect(removeVisuallyBlankResumeLine(editor)).toBe(false);
    expect(editor.state.doc.firstChild?.type.name).toBe("resumeRow");
    expect(editor.state.doc.firstChild?.textContent).toBe("右侧内容");
  });

  it("专业模板 Markdown 会迁移为可编辑布局节点并保留图标名称", () => {
    const html = renderResumeMarkdown(`:::: sidebar
联系信息
::::

:::: main
## :icon[Briefcase]: 工作经历
::::

:::: meta
2024.01 - 至今
示例组织
运营
负责人
::::

:::: trio
Figma
4 年
熟练
::::`);
    editor = new Editor({ extensions: resumeEditorExtensions, content: html });

    expect(editor.getJSON().content).toMatchObject([
      {
        type: "resumeColumns",
        content: [
          { type: "resumeColumn", attrs: { variant: "sidebar" } },
          {
            type: "resumeColumn",
            attrs: { variant: "main" },
            content: [{
              type: "heading",
              content: [{ type: "inlineIcon", attrs: { name: "Briefcase" } }, { type: "text", text: " 工作经历" }],
            }],
          },
        ],
      },
      { type: "resumeMetaRow" },
      { type: "resumeTrioRow" },
    ]);
  });

  it("双栏模板会完整解析侧栏与正文中的嵌套布局块", () => {
    const html = renderResumeMarkdown(`:::: sidebar
# 张三｜UI 设计师

:::: trio
Photoshop
5 年
精通
::::
::::

:::: main
## :icon[GraduationCap]: 教育经历

::: left
海岚艺术大学
:::

::: right
2021.09 - 2024.06
:::
::::`);
    editor = new Editor({ extensions: resumeEditorExtensions, content: html });

    expect(html).not.toContain("::::");
    expect(html).not.toContain("::: left");
    expect(editor.getJSON().content).toMatchObject([{
      type: "resumeColumns",
      content: [
        {
          type: "resumeColumn",
          attrs: { variant: "sidebar" },
          content: [
            { type: "heading", attrs: { level: 1 } },
            { type: "resumeTrioRow" },
          ],
        },
        {
          type: "resumeColumn",
          attrs: { variant: "main" },
          content: [
            { type: "heading", attrs: { level: 2 } },
            { type: "resumeRow" },
          ],
        },
      ],
    }]);
  });

  it("保存并恢复当前行的左栏比例", () => {
    const html = renderResumeMarkdown("::: left 62\n示例大学\n:::\n\n::: right\n2022 – 2026\n:::");
    editor = new Editor({ extensions: resumeEditorExtensions, content: html });

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "resumeRow",
      attrs: { leftWidth: 62 },
    });
  });
});

describe("左右分栏分割线", () => {
  it("按指针位置计算比例并限制在可编辑范围", () => {
    expect(resumeRowWidthFromClientX(500, 0, 1000)).toBe(50);
    expect(resumeRowWidthFromClientX(100, 0, 1000)).toBe(30);
    expect(resumeRowWidthFromClientX(950, 0, 1000)).toBe(80);
    expect(resumeRowWidthFromClientX(500, 0, 0)).toBe(50);
  });

  it("无有效保存值时使用一半一半", () => {
    expect(normalizeResumeRowWidth(undefined)).toBe(50);
    expect(normalizeResumeRowWidth("62")).toBe(62);
  });

  it("渲染可访问分割线并支持键盘调整", async () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: "resumeRow",
          content: [{ type: "paragraph", content: [{ type: "text", text: "左" }] }, { type: "paragraph", content: [{ type: "text", text: "右" }] }],
        }],
      },
    });
    render(createElement(EditorContent, { editor }));

    const divider = await vi.waitFor(() => {
      const element = editor?.view.dom.querySelector<HTMLButtonElement>(".resume-row-divider");
      expect(element).not.toBeNull();
      return element as HTMLButtonElement;
    });
    expect(divider.getAttribute("aria-valuetext")).toBe("左栏 50%，右栏 50%");

    divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    await vi.waitFor(() => expect(editor?.getJSON().content?.[0].attrs?.leftWidth).toBe(51));
  });
});

import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertCurrentLineToResumeRow, convertResumeRowToParagraph } from "./editorCommands";
import { normalizeResumeRowWidth, resumeEditorExtensions, resumeRowWidthFromClientX } from "./editorExtensions";
import { renderResumeMarkdown } from "../../parser/resumeMarkdown";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("convertCurrentLineToResumeRow", () => {
  it("保留当前行内容并创建可独立编辑的右栏", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "星河云科技" }] }] },
    });
    editor.commands.setTextSelection(3);

    expect(convertCurrentLineToResumeRow(editor)).toBe(true);
    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [{
        type: "resumeRow",
        attrs: { leftWidth: 50 },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "星河云科技" }] },
          { type: "paragraph" },
        ],
      }],
    });
    expect(editor.isActive("resumeRow")).toBe(true);
    expect(editor.state.selection.$from.parent).toEqual(editor.state.doc.firstChild?.child(1));
    expect(editor.state.selection.$from.parentOffset).toBe(0);
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

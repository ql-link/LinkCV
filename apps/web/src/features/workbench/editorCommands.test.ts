import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { convertCurrentLineToResumeRow, convertResumeRowToParagraph } from "./editorCommands";
import { resumeEditorExtensions } from "./editorExtensions";
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
        attrs: { leftWidth: 65 },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "星河云科技" }] },
          { type: "paragraph" },
        ],
      }],
    });
    expect(editor.isActive("resumeRow")).toBe(true);
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
});

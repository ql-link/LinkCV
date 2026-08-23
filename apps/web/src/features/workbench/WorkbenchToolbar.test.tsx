import { Editor } from "@tiptap/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorDocumentToMarkdown } from "../../api/resumeContract";
import { renderResumeMarkdown } from "../../parser/resumeMarkdown";
import { resumeEditorExtensions } from "./editorExtensions";
import { SelectionAgentPrompt, WorkbenchToolbar } from "./WorkbenchToolbar";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("WorkbenchToolbar 局部字号", () => {
  it("光标未选中文字时仍显示独立格式功能栏", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>正文</p>" });
    editor.commands.setTextSelection(1);

    render(<WorkbenchToolbar editor={editor} resumeId="42" defaultFontSize={10.5} onNotice={() => undefined} />);

    expect(screen.getByRole("toolbar", { name: "简历格式工具栏" })).toBeVisible();
  });

  it("以全局正文字号为基准调整选中文字", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<WorkbenchToolbar editor={editor} resumeId="42" defaultFontSize={10.5} onNotice={() => undefined} />);

    expect(screen.getByLabelText("所选文字字号数值")).toHaveTextContent("10.5pt");
    await user.click(screen.getByRole("button", { name: "所选文字字号减小" }));

    const text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks).toContainEqual({ type: "textStyle", attrs: expect.objectContaining({ fontSize: "10pt" }) });
  });

  it("保存并重新载入后保留局部字号", () => {
    const markdown = editorDocumentToMarkdown({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "重点文字",
          marks: [{ type: "textStyle", attrs: { fontSize: "9.5pt" } }],
        }],
      }],
    });

    editor = new Editor({ extensions: resumeEditorExtensions, content: renderResumeMarkdown(markdown) });

    const text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks).toContainEqual({ type: "textStyle", attrs: expect.objectContaining({ fontSize: "9.5pt" }) });
  });
});

describe("WorkbenchToolbar 当前行左右对齐", () => {
  it("右对齐保持普通段落语义，不转换为左右对齐行", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>示例大学 2022–2026</p>" });
    editor.commands.setTextSelection({ from: 6, to: 15 });
    render(<WorkbenchToolbar editor={editor} resumeId="42" defaultFontSize={10.5} onNotice={() => undefined} />);

    await user.click(screen.getByRole("button", { name: "右对齐" }));

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "paragraph",
      attrs: expect.objectContaining({ textAlign: "right" }),
      content: expect.arrayContaining([{ type: "text", text: "示例大学 2022–2026" }]),
    });
  });
});

describe("WorkbenchToolbar 选中文字 AI 快捷操作", () => {
  it("把所选文字和快捷指令交给右侧智能助手", async () => {
    const user = userEvent.setup();
    const onAgentAction = vi.fn();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>负责平台性能优化</p>" });
    editor.commands.setTextSelection({ from: 1, to: 9 });

    render(<SelectionAgentPrompt editor={editor} onAgentAction={onAgentAction} />);

    await user.click(screen.getByRole("button", { name: "AI" }));
    expect(screen.getByRole("menu", { name: "所选文字 AI 快捷操作" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "优化表达" }));

    expect(onAgentAction).toHaveBeenCalledWith("优化表达", expect.objectContaining({
      block_ids: [expect.stringMatching(/^blk_[a-z0-9]{16,64}$/)],
      selected_text: "负责平台性能优化",
      selected_text_hash: "sha256:3d4d668a9062835f402347676f24927855bb46bc4f627768d160265c63d16c87",
    }));
  });
});

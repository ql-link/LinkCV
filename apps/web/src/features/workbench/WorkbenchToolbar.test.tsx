import { Editor } from "@tiptap/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resumeEditorExtensions } from "./editorExtensions";
import { SelectionFormattingToolbar } from "./WorkbenchToolbar";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("SelectionFormattingToolbar", () => {
  it("只在选中文字后显示截图指定的八个工具", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection(1);
    const onAgentAction = vi.fn();
    const { rerender } = render(<SelectionFormattingToolbar editor={editor} onAgentAction={onAgentAction} />);

    expect(screen.queryByRole("toolbar", { name: "所选文字工具栏" })).not.toBeInTheDocument();

    editor.commands.setTextSelection({ from: 1, to: 5 });
    rerender(<SelectionFormattingToolbar editor={editor} onAgentAction={onAgentAction} />);

    const toolbar = screen.getByRole("toolbar", { name: "所选文字工具栏" });
    expect(within(toolbar).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "加粗",
      "斜体",
      "下划线",
      "文字颜色",
      "高亮颜色",
      "无序列表",
      "增加缩进",
      "AI 修改",
    ]);
  });

  it("对当前选区应用文字格式和高亮", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<SelectionFormattingToolbar editor={editor} onAgentAction={() => undefined} />);

    await user.click(screen.getByRole("button", { name: "加粗" }));
    await user.click(screen.getByRole("button", { name: "高亮颜色" }));
    await user.click(screen.getByRole("button", { name: "高亮颜色 #fff3c4" }));

    const text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks).toContainEqual({ type: "bold" });
    expect(text?.marks).toContainEqual({ type: "highlight", attrs: { color: "#fff3c4" } });
  });

  it("重新选中已有颜色和高亮的文字时显示激活状态", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{
            type: "text",
            text: "重点文字",
            marks: [
              { type: "textStyle", attrs: { color: "#3478f6" } },
              { type: "highlight", attrs: { color: "#fff3c4" } },
            ],
          }],
        }],
      },
    });
    editor.commands.setTextSelection({ from: 1, to: 5 });

    render(<SelectionFormattingToolbar editor={editor} onAgentAction={() => undefined} />);

    expect(screen.getByRole("button", { name: "文字颜色" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "高亮颜色" })).toHaveAttribute("aria-pressed", "true");
  });

  it("把所选文字和快捷指令交给右侧智能助手", async () => {
    const user = userEvent.setup();
    const onAgentAction = vi.fn();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>负责平台性能优化</p>" });
    editor.commands.setTextSelection({ from: 1, to: 9 });

    render(<SelectionFormattingToolbar editor={editor} onAgentAction={onAgentAction} />);

    await user.click(screen.getByRole("button", { name: "AI 修改" }));
    expect(screen.getByRole("menu", { name: "所选文字 AI 快捷操作" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "优化表达" }));

    expect(onAgentAction).toHaveBeenCalledWith("优化表达", expect.objectContaining({
      block_ids: [expect.stringMatching(/^node_[a-z0-9]{16,64}$/)],
      selected_text: "负责平台性能优化",
      selected_text_hash: "sha256:3d4d668a9062835f402347676f24927855bb46bc4f627768d160265c63d16c87",
    }));
  });
});

describe("简历邮箱文本", () => {
  it("不自动链接邮箱，但继续自动链接普通网址", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p></p>" });

    editor.commands.insertContent("zhangsan@example.com ");
    editor.commands.insertContent("https://example.com ");

    const textNodes = editor.getJSON().content?.[0]?.content ?? [];
    const email = textNodes.find((node) => node.text === "zhangsan@example.com");
    const website = textNodes.find((node) => node.text === "https://example.com");
    expect(email?.marks?.some((mark) => mark.type === "link")).not.toBe(true);
    expect(website?.marks).toContainEqual(expect.objectContaining({
      type: "link",
      attrs: expect.objectContaining({ href: "https://example.com" }),
    }));
  });

  it("拒绝手动把邮箱设置为 mailto 链接", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: "<p>zhangsan@example.com</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 21 });

    const applied = editor.commands.setLink({ href: "mailto:zhangsan@example.com" });

    expect(applied).toBe(false);
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toBeUndefined();
  });
});

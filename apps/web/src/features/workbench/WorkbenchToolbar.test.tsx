import { Editor } from "@tiptap/core";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resumeEditorExtensions } from "./editorExtensions";
import { SelectionFormattingToolbar, WorkbenchHistoryActions } from "./WorkbenchToolbar";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.getElementById("font-size-fixture")?.remove();
});

describe("SelectionFormattingToolbar", () => {
  it("只在选中文字后显示字号和格式工具", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection(1);
    const { rerender } = render(<SelectionFormattingToolbar editor={editor} />);

    expect(screen.queryByRole("toolbar", { name: "所选文字工具栏" })).not.toBeInTheDocument();

    editor.commands.setTextSelection({ from: 1, to: 5 });
    rerender(<SelectionFormattingToolbar editor={editor} />);

    const toolbar = screen.getByRole("toolbar", { name: "所选文字工具栏" });
    expect(within(toolbar).getByLabelText("所选文字字号")).toHaveTextContent("12pt");
    expect(within(toolbar).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "增大字号",
      "减小字号",
      "加粗",
      "斜体",
      "下划线",
      "文字颜色",
      "高亮颜色",
    ]);
  });

  it("列表、缩进、恢复默认字号和 AI 修改都不再出现在选中弹窗里", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<SelectionFormattingToolbar editor={editor} />);

    const toolbar = screen.getByRole("toolbar", { name: "所选文字工具栏" });
    expect(within(toolbar).queryByLabelText("无序列表")).not.toBeInTheDocument();
    expect(within(toolbar).queryByLabelText("增加缩进")).not.toBeInTheDocument();
    expect(within(toolbar).queryByLabelText("恢复默认字号")).not.toBeInTheDocument();
    expect(within(toolbar).queryByLabelText("AI 修改")).not.toBeInTheDocument();
  });

  it("只改变选中的单字字号，保留其他格式并支持撤销重做", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: '<p><strong><span style="color:#3478f6">重点文字</span></strong></p>' });
    editor.commands.setTextSelection({ from: 2, to: 3 });
    const originalSelection = { from: editor.state.selection.from, to: editor.state.selection.to };
    render(<SelectionFormattingToolbar editor={editor} />);

    await user.click(screen.getByRole("button", { name: "增大字号" }));
    expect(editor.state.selection.from).toBe(originalSelection.from);
    expect(editor.state.selection.to).toBe(originalSelection.to);
    expect(editor.view.dom.querySelector('[style*="font-size"]')).toHaveTextContent("点");
    expect(editor.view.dom.querySelectorAll('[style*="font-size"]')).toHaveLength(1);
    expect(screen.getByLabelText("所选文字字号")).toHaveTextContent("12.5pt");
    act(() => { editor!.commands.undo(); });
    expect(editor.view.dom.querySelector('[style*="font-size"]')).toBeNull();
    act(() => { editor!.commands.redo(); });
    expect(editor.view.dom.querySelector('[style*="font-size"]')).toHaveTextContent("点");

    // 字号只落在选中的单字上，加粗和颜色都保留。
    expect(editor.view.dom.querySelector("strong")).toHaveTextContent("重");
    expect(editor.getHTML()).toContain("color: rgb(52, 120, 246)");
  });

  it("混合字号选区可统一为一个字号，跨段落保留边界外的文字", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: '<p>第一段</p><p><span style="font-size:14pt">第二段</span></p><p>不改变</p>' });
    editor.commands.setTextSelection({ from: 1, to: 9 });
    render(<SelectionFormattingToolbar editor={editor} />);
    expect(screen.getByLabelText("所选文字字号")).toHaveTextContent("混合");
    await user.click(screen.getByRole("button", { name: "增大字号" }));
    const paragraphs = editor.view.dom.querySelectorAll("p");
    expect(paragraphs[0].querySelector("span[style]")).toHaveStyle({ fontSize: "12.5pt" });
    expect(paragraphs[1].querySelector("span[style]")).toHaveStyle({ fontSize: "12.5pt" });
    expect(paragraphs[2].querySelector("span[style]")).toBeNull();
    expect(screen.getByLabelText("所选文字字号")).toHaveTextContent("12.5pt");
  });

  it("连续点击保持选区，支持非半点字号与重新选择", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: '<p><span style="font-size:11.2pt">甲</span>乙</p>' });
    editor.commands.setTextSelection({ from: 1, to: 2 });
    render(<SelectionFormattingToolbar editor={editor} />);
    const selectedText = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);
    const control = screen.getByLabelText("所选文字字号");
    expect(control).toHaveTextContent("11.2pt");
    await user.click(screen.getByRole("button", { name: "增大字号" }));
    await user.click(screen.getByRole("button", { name: "增大字号" }));
    await user.click(screen.getByRole("button", { name: "减小字号" }));
    expect(control).toHaveTextContent("11.7pt");
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe(selectedText);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    act(() => {
      editor!.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "乙") editor!.commands.setTextSelection({ from: pos, to: pos + 1 });
      });
    });
    expect(control).toHaveTextContent("12pt");
  });

  it("显示标题继承的实际字号并从该字号直接步进", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: '<h2>工作经历</h2><p>正文</p>' });
    const host = document.createElement("div");
    host.id = "font-size-fixture";
    host.innerHTML = "<style>#font-size-fixture h2 { font-size: 32px; }</style>";
    host.append(editor.view.dom);
    document.body.append(host);
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<SelectionFormattingToolbar editor={editor} />);
    expect(screen.getByLabelText("所选文字字号")).toHaveTextContent("24pt");
    await user.click(screen.getByRole("button", { name: "增大字号" }));
    expect(editor.view.dom.querySelector("h2 span[style]")).toHaveStyle({ fontSize: "24.5pt" });
    act(() => { editor!.commands.selectAll(); });
    await user.click(screen.getByRole("button", { name: "减小字号" }));
    expect(editor.view.dom.querySelector("h2 span[style]")).toHaveStyle({ fontSize: "24pt" });
    expect(editor.view.dom.querySelector("p span[style]")).toHaveStyle({ fontSize: "24pt" });
  });

  it("到达上下限后禁用对应箭头，键盘可以直接调整", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: '<p><span style="font-size:47.8pt">甲</span><span style="font-size:6.2pt">乙</span></p>' });
    editor.commands.setTextSelection({ from: 1, to: 2 });
    render(<SelectionFormattingToolbar editor={editor} />);
    const increase = screen.getByRole("button", { name: "增大字号" });
    act(() => { increase.focus(); });
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("所选文字字号")).toHaveTextContent("48pt");
    expect(increase).toBeDisabled();
    act(() => {
      editor!.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "乙") editor!.commands.setTextSelection({ from: pos, to: pos + 1 });
      });
    });
    await user.click(screen.getByRole("button", { name: "减小字号" }));
    expect(screen.getByLabelText("所选文字字号")).toHaveTextContent("6pt");
    expect(screen.getByRole("button", { name: "减小字号" })).toBeDisabled();
  });

  it("对当前选区应用粗体、斜体和高亮", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<SelectionFormattingToolbar editor={editor} />);

    await user.click(screen.getByRole("button", { name: "加粗" }));
    await user.click(screen.getByRole("button", { name: "斜体" }));
    await user.click(screen.getByRole("button", { name: "高亮颜色" }));
    await user.click(screen.getByRole("button", { name: "高亮颜色 #fff3c4" }));

    const text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks).toContainEqual({ type: "bold" });
    expect(text?.marks).toContainEqual({ type: "italic" });
    expect(text?.marks).toContainEqual({ type: "highlight", attrs: { color: "#fff3c4" } });
    expect(editor.view.dom.querySelector("em")).toHaveTextContent("重点文字");
  });

  it("文字颜色与高亮颜色独立应用和取消", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<SelectionFormattingToolbar editor={editor} />);

    await user.click(screen.getByRole("button", { name: "文字颜色" }));
    await user.click(screen.getByRole("button", { name: "文字颜色 #3478f6" }));

    let text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks).toContainEqual({
      type: "textStyle",
      attrs: { color: "#3478f6", fontSize: null },
    });
    expect(text?.marks?.some((mark) => mark.type === "highlight")).not.toBe(true);

    await user.click(screen.getByRole("button", { name: "高亮颜色" }));
    await user.click(screen.getByRole("button", { name: "高亮颜色 #fff3c4" }));
    text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks).toContainEqual({ type: "highlight", attrs: { color: "#fff3c4" } });
    expect(text?.marks).toContainEqual({
      type: "textStyle",
      attrs: { color: "#3478f6", fontSize: null },
    });

    await user.click(screen.getByRole("button", { name: "高亮颜色" }));
    await user.click(screen.getByRole("button", { name: "取消高亮颜色" }));
    text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks?.some((mark) => mark.type === "highlight")).not.toBe(true);
    expect(text?.marks).toContainEqual({
      type: "textStyle",
      attrs: { color: "#3478f6", fontSize: null },
    });

    await user.click(screen.getByRole("button", { name: "文字颜色" }));
    await user.click(screen.getByRole("button", { name: "取消文字颜色" }));
    text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks?.some((mark) => mark.type === "textStyle")).not.toBe(true);
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

    render(<SelectionFormattingToolbar editor={editor} />);

    expect(screen.getByRole("button", { name: "文字颜色" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "高亮颜色" })).toHaveAttribute("aria-pressed", "true");
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

describe("WorkbenchHistoryActions", () => {
  it("没有可撤销内容时两个按钮都禁用", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>正文</p>" });
    render(<WorkbenchHistoryActions editor={editor} />);

    const group = screen.getByRole("group", { name: "撤销与重做" });
    expect(within(group).getByRole("button", { name: /撤销/ })).toBeDisabled();
    expect(within(group).getByRole("button", { name: /重做/ })).toBeDisabled();
  });

  it("编辑后可以撤销并重做，按钮状态跟着历史变化", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>正文</p>" });
    render(<WorkbenchHistoryActions editor={editor} />);
    const group = screen.getByRole("group", { name: "撤销与重做" });
    const undo = () => within(group).getByRole("button", { name: /撤销/ });
    const redo = () => within(group).getByRole("button", { name: /重做/ });

    act(() => { editor!.commands.insertContentAt(4, "新"); });
    expect(undo()).toBeEnabled();
    expect(redo()).toBeDisabled();

    await user.click(undo());
    expect(editor.view.dom.textContent).toBe("正文");
    expect(undo()).toBeDisabled();
    expect(redo()).toBeEnabled();

    await user.click(redo());
    expect(editor.view.dom.textContent).toBe("正文新");
    expect(undo()).toBeEnabled();
    expect(redo()).toBeDisabled();
  });
});

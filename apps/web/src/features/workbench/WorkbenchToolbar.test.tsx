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
});

describe("SelectionFormattingToolbar", () => {
  it("只在选中文字后显示格式工具，并按约定顺序排列按钮", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection(1);
    const { rerender } = render(<SelectionFormattingToolbar editor={editor} />);

    expect(screen.queryByRole("toolbar", { name: "所选文字工具栏" })).not.toBeInTheDocument();

    editor.commands.setTextSelection({ from: 1, to: 5 });
    rerender(<SelectionFormattingToolbar editor={editor} />);

    const toolbar = screen.getByRole("toolbar", { name: "所选文字工具栏" });
    expect(within(toolbar).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "加粗",
      "删除线",
      "斜体",
      "下划线",
      "链接",
      "字体",
      "本行类型",
      "对齐方式",
    ]);
  });

  it("代码块、列表和 AI 修改都不再出现在选中弹窗里", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<SelectionFormattingToolbar editor={editor} />);

    const toolbar = screen.getByRole("toolbar", { name: "所选文字工具栏" });
    // 字号收在「字体」弹层里，不再单独占用工具栏上的位置。
    expect(within(toolbar).queryByLabelText("所选文字字号")).not.toBeInTheDocument();
    expect(within(toolbar).queryByLabelText("代码块")).not.toBeInTheDocument();
    expect(within(toolbar).queryByLabelText("无序列表")).not.toBeInTheDocument();
    expect(within(toolbar).queryByLabelText("AI 修改")).not.toBeInTheDocument();
  });

  it("对当前选区应用粗体、删除线、斜体、下划线和背景颜色", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<SelectionFormattingToolbar editor={editor} />);

    await user.click(screen.getByRole("button", { name: "加粗" }));
    await user.click(screen.getByRole("button", { name: "删除线" }));
    await user.click(screen.getByRole("button", { name: "斜体" }));
    await user.click(screen.getByRole("button", { name: "下划线" }));
    await user.click(screen.getByRole("button", { name: "字体" }));
    await user.click(screen.getByRole("button", { name: "背景颜色 #fff3c4" }));

    const text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks).toContainEqual({ type: "bold" });
    expect(text?.marks).toContainEqual({ type: "strike" });
    expect(text?.marks).toContainEqual({ type: "italic" });
    expect(text?.marks).toContainEqual({ type: "underline" });
    expect(text?.marks).toContainEqual({ type: "highlight", attrs: { color: "#fff3c4" } });
    expect(editor.view.dom.querySelector("em")).toHaveTextContent("重点文字");
  });

  it("字号、字体颜色与背景颜色在同一个弹层中各自独立生效", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<SelectionFormattingToolbar editor={editor} />);

    const openColors = () => user.click(screen.getByRole("button", { name: "字体" }));

    await openColors();
    const popover = screen.getByRole("group", { name: "字体" });
    expect(within(popover).getByText("字体颜色")).toBeInTheDocument();
    expect(within(popover).getByText("背景颜色")).toBeInTheDocument();
    await user.click(within(popover).getByRole("button", { name: "文字颜色 #3478f6" }));

    let text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks).toContainEqual({
      type: "textStyle",
      attrs: { color: "#3478f6", fontSize: null },
    });
    expect(text?.marks?.some((mark) => mark.type === "highlight")).not.toBe(true);

    await openColors();
    await user.click(screen.getByRole("button", { name: "背景颜色 #fff3c4" }));
    text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks).toContainEqual({ type: "highlight", attrs: { color: "#fff3c4" } });
    expect(text?.marks).toContainEqual({
      type: "textStyle",
      attrs: { color: "#3478f6", fontSize: null },
    });

    await openColors();
    await user.click(screen.getByRole("button", { name: "取消背景颜色" }));
    text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks?.some((mark) => mark.type === "highlight")).not.toBe(true);
    expect(text?.marks).toContainEqual({
      type: "textStyle",
      attrs: { color: "#3478f6", fontSize: null },
    });

    await openColors();
    await user.click(screen.getByRole("button", { name: "恢复默认颜色" }));
    text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks?.some((mark) => mark.type === "textStyle")).not.toBe(true);
    expect(text?.marks?.some((mark) => mark.type === "highlight")).not.toBe(true);
  });

  it("字号步进器按 0.5pt 调整选中文字，保留其他格式与选区", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: '<p><strong><span style="color:#3478f6">重点文字</span></strong></p>' });
    editor.commands.setTextSelection({ from: 2, to: 3 });
    const originalSelection = { from: editor.state.selection.from, to: editor.state.selection.to };
    render(<SelectionFormattingToolbar editor={editor} />);

    await user.click(screen.getByRole("button", { name: "字体" }));
    await user.click(screen.getByRole("button", { name: "增大字号" }));

    expect(editor.state.selection.from).toBe(originalSelection.from);
    expect(editor.state.selection.to).toBe(originalSelection.to);
    expect(editor.view.dom.querySelector('[style*="font-size"]')).toHaveTextContent("点");
    expect(editor.view.dom.querySelectorAll('[style*="font-size"]')).toHaveLength(1);
    expect(screen.getByLabelText("所选文字字号")).toHaveTextContent("12.5pt");
    // 字号只落在选中的单字上，加粗和颜色都保留。
    expect(editor.view.dom.querySelector("strong")).toHaveTextContent("重");
    expect(editor.getHTML()).toContain("color: rgb(52, 120, 246)");
  });

  it("混合字号显示「混合」并把选区统一为一个字号", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: '<p>第一段</p><p><span style="font-size:14pt">第二段</span></p><p>不改变</p>' });
    editor.commands.setTextSelection({ from: 1, to: 9 });
    render(<SelectionFormattingToolbar editor={editor} />);

    await user.click(screen.getByRole("button", { name: "字体" }));
    expect(screen.getByLabelText("所选文字字号")).toHaveTextContent("混合");

    await user.click(screen.getByRole("button", { name: "增大字号" }));
    const paragraphs = editor.view.dom.querySelectorAll("p");
    expect(paragraphs[0].querySelector("span[style]")).toHaveStyle({ fontSize: "12.5pt" });
    expect(paragraphs[1].querySelector("span[style]")).toHaveStyle({ fontSize: "12.5pt" });
    expect(paragraphs[2].querySelector("span[style]")).toBeNull();
    expect(screen.getByLabelText("所选文字字号")).toHaveTextContent("12.5pt");
  });

  it("字号到达上下限后禁用对应箭头", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: '<p><span style="font-size:47.8pt">甲</span><span style="font-size:6.2pt">乙</span></p>' });
    editor.commands.setTextSelection({ from: 1, to: 2 });
    render(<SelectionFormattingToolbar editor={editor} />);

    await user.click(screen.getByRole("button", { name: "字体" }));
    const increase = screen.getByRole("button", { name: "增大字号" });
    await user.click(increase);
    expect(screen.getByLabelText("所选文字字号")).toHaveTextContent("48pt");
    expect(increase).toBeDisabled();
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

    expect(screen.getByRole("button", { name: "字体" })).toHaveAttribute("aria-pressed", "true");
  });

  it("链接按钮填写网址后应用，并可以取消链接", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<SelectionFormattingToolbar editor={editor} />);

    await user.click(screen.getByRole("button", { name: "链接" }));
    await user.type(screen.getByLabelText("链接地址"), "https://example.com");
    await user.click(screen.getByRole("button", { name: "应用" }));

    let text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks).toContainEqual({
      type: "link",
      attrs: expect.objectContaining({ href: "https://example.com" }),
    });

    await user.click(screen.getByRole("button", { name: "链接" }));
    await user.click(screen.getByRole("button", { name: "取消链接" }));

    text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks?.some((mark) => mark.type === "link")).not.toBe(true);
  });

  it("链接按钮拒绝把邮箱作为简历链接", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>重点文字</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<SelectionFormattingToolbar editor={editor} />);

    await user.click(screen.getByRole("button", { name: "链接" }));
    await user.type(screen.getByLabelText("链接地址"), "zhangsan@example.com");
    await user.click(screen.getByRole("button", { name: "应用" }));

    expect(screen.getByRole("alert")).toHaveTextContent("邮箱属于简历联系方式");
    const text = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "text");
    expect(text?.marks?.some((mark) => mark.type === "link")).not.toBe(true);
  });

  it("本行类型下拉可以切换正文与标题层级", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>工作经历</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<SelectionFormattingToolbar editor={editor} />);

    await user.click(screen.getByRole("button", { name: "本行类型" }));
    await user.click(screen.getByRole("menuitemradio", { name: "二级标题" }));
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });

    await user.click(screen.getByRole("button", { name: "本行类型" }));
    expect(screen.getByRole("menuitemradio", { name: "二级标题" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("menuitemradio", { name: "正文" }));
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "paragraph" });
  });

  it("对齐方式下拉可以设置左、中、右对齐", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content: "<p>工作经历</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    render(<SelectionFormattingToolbar editor={editor} />);

    await user.click(screen.getByRole("button", { name: "对齐方式" }));
    await user.click(screen.getByRole("menuitemradio", { name: "居中对齐" }));
    expect(editor.isActive({ textAlign: "center" })).toBe(true);

    await user.click(screen.getByRole("button", { name: "对齐方式" }));
    await user.click(screen.getByRole("menuitemradio", { name: "右对齐" }));
    expect(editor.isActive({ textAlign: "right" })).toBe(true);
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

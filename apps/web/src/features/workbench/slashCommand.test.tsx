import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { EditorContent } from "@tiptap/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { editorDocumentToMarkdown } from "../../api/resumeContract";
import { renderResumeMarkdown } from "../../parser/resumeMarkdown";
import { resumeEditorExtensions } from "./editorExtensions";
import {
  editableLineStartPositions,
  filterWorkbenchCommands,
  LineInsertMenuExtension,
  SlashCommandMenu,
} from "./slashCommand";

describe("命令面板过滤", () => {
  it("支持按中文命令名和关键词过滤", () => {
    expect(filterWorkbenchCommands("分栏").map((item) => item.id)).toEqual(["resume-row"]);
    expect(filterWorkbenchCommands("h2").map((item) => item.id)).toEqual(["heading-2"]);
  });

  it("空查询展示全部块命令", () => {
    expect(filterWorkbenchCommands("").length).toBeGreaterThan(8);
    expect(filterWorkbenchCommands("")[1]).toMatchObject({ id: "resume-row", label: "左右分栏" });
    expect(filterWorkbenchCommands("").map((item) => item.id)).not.toContain("avatar");
    expect(filterWorkbenchCommands("").map((item) => item.label)).not.toContain("上传或更换头像");
    expect(filterWorkbenchCommands("头像")).toEqual([]);
  });
});

describe("逐行插入入口", () => {
  it("光标落入左栏行首按钮时同步回正文并保留连续输入", async () => {
    const editor = new Editor({
      extensions: [...resumeEditorExtensions, LineInsertMenuExtension],
      editorProps: { handleScrollToSelection: () => true },
      content: '<div data-type="resume-row"><p><strong>左侧文字</strong></p><p>右侧文字</p></div>',
    });
    render(<EditorContent editor={editor} />);
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 2);
      editor.view.focus();
      const button = await vi.waitFor(() => {
        const element = editor.view.dom.querySelector<HTMLButtonElement>(".resume-line-add");
        expect(element).not.toBeNull();
        return element!;
      });
      // 模拟浏览器在行首不可编辑 widget 内报告折叠光标。
      const selection = window.getSelection()!;
      selection.setBaseAndExtent(button.firstChild!, 0, button.firstChild!, 0);
      document.dispatchEvent(new Event("selectionchange"));

      await vi.waitFor(() => {
        expect(editor.state.selection.from).toBe(editableLineStartPositions(editor.state)[0]);
      });
      for (const character of "abc测试") {
        editor.view.dispatch(editor.state.tr.insertText(character));
      }
      expect(editor.state.doc.firstChild?.child(0).textContent).toBe("abc测试左侧文字");
      expect(editor.state.doc.firstChild?.child(1).textContent).toBe("右侧文字");
      expect(button.textContent).toBe("+");

      // 用 DOM 变更模拟输入法逐步替换组合文本，再连续提交两次中文。
      let committed = "abc测试";
      for (const candidates of [["n", "ni", "你"], ["h", "hao", "好"]]) {
        editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        for (const candidate of candidates) {
          const paragraph = editor.view.dom.querySelector(".resume-line-add")!.parentElement!;
          const text = [...paragraph.childNodes].find((child) => child.nodeType === Node.TEXT_NODE)!;
          text.textContent = committed + candidate;
          selection.setBaseAndExtent(text, text.textContent.length, text, text.textContent.length);
          editor.view.dom.dispatchEvent(new CompositionEvent("compositionupdate", { data: candidate, bubbles: true }));
          await vi.waitFor(() => {
            expect(editor.state.doc.firstChild?.child(0).textContent).toBe(`${committed}${candidate}左侧文字`);
          });
        }
        editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { data: candidates[2], bubbles: true }));
        committed += candidates[2];
      }
      expect(editor.state.doc.firstChild?.child(0).textContent).toBe("abc测试你好左侧文字");
      expect(editor.state.doc.firstChild?.child(1).textContent).toBe("右侧文字");
    } finally {
      editor.destroy();
    }
  });

  it("为空白行和非空行都提供加号，并能把光标放到对应行开头", () => {
    const onOpen = vi.fn();
    const editor = new Editor({
      extensions: [Document, Paragraph, Text, LineInsertMenuExtension.configure({ onOpen })],
      content: "<p></p><p>已有内容</p><p></p>",
    });

    editor.commands.setTextSelection(1);
    const buttons = editor.view.dom.querySelectorAll<HTMLButtonElement>(".resume-line-add");
    const linePositions = editableLineStartPositions(editor.state);
    expect(buttons).toHaveLength(3);
    expect(linePositions).toHaveLength(3);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("在此行开头插入内容");
    expect(buttons[0]).not.toHaveAttribute("data-active");

    buttons[1]?.click();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ query: "", replaceRange: null }));
    expect(editor.state.selection.from).toBe(linePositions[1]);

    editor.commands.setTextSelection(3);
    expect(editor.view.dom.querySelectorAll(".resume-line-add")).toHaveLength(3);
    expect([...editor.view.dom.querySelectorAll<HTMLElement>(".resume-line-add")]
      .every((button) => !button.hasAttribute("data-active"))).toBe(true);
    editor.destroy();
  });

  it("左右分栏整行只提供一个入口，并定位到左侧稳定定位符之后", () => {
    const onOpen = vi.fn();
    const editor = new Editor({
      extensions: [...resumeEditorExtensions, LineInsertMenuExtension.configure({ onOpen })],
      content: {
        type: "doc",
        content: [{
          type: "resumeRow",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "resumeBlockAnchor", attrs: { blockId: "blk_1234567890abcdef" } },
                { type: "text", text: "公司实习" },
              ],
            },
            {
              type: "paragraph",
              content: [
                { type: "resumeBlockAnchor", attrs: { blockId: "blk_fedcba0987654321" } },
                { type: "text", text: "2025.01" },
              ],
            },
          ],
        }],
      },
    });

    const positions = editableLineStartPositions(editor.state);
    const buttons = editor.view.dom.querySelectorAll<HTMLButtonElement>(".resume-line-add");
    expect(positions).toHaveLength(1);
    expect(buttons).toHaveLength(1);

    buttons[0]?.click();
    expect(editor.state.selection.from).toBe(positions[0]);
    expect(editor.state.selection.$from.parent.firstChild?.type.name).toBe("resumeBlockAnchor");
    expect(editor.state.selection.$from.parentOffset).toBe(1);
    editor.destroy();
  });

  it("固定多列信息行各自只提供一个入口，普通列表项仍逐行提供", () => {
    const editor = new Editor({
      extensions: [...resumeEditorExtensions, LineInsertMenuExtension.configure({ onOpen: vi.fn() })],
      content: {
        type: "doc",
        content: [
          {
            type: "resumeMetaRow",
            content: ["日期", "学校", "专业", "成绩"].map((text) => ({
              type: "paragraph",
              content: [{ type: "text", text }],
            })),
          },
          {
            type: "resumeTrioRow",
            content: ["Java", "TypeScript", "Python"].map((text) => ({
              type: "paragraph",
              content: [{ type: "text", text }],
            })),
          },
          {
            type: "bulletList",
            content: ["第一项", "第二项"].map((text) => ({
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text }] }],
            })),
          },
        ],
      },
    });

    expect(editableLineStartPositions(editor.state)).toHaveLength(4);
    expect(editor.view.dom.querySelectorAll(".resume-line-add")).toHaveLength(4);
    editor.destroy();
  });

  it("加号菜单前排展示左右分栏并可直接创建", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const editor = new Editor({ extensions: resumeEditorExtensions, content: "<p></p>" });
    editor.commands.setTextSelection(1);

    render(
      <SlashCommandMenu
        editor={editor}
        resumeId="42"
        state={{ x: 10, y: 10, query: "", replaceRange: null }}
        onClose={onClose}
        onNotice={vi.fn()}
      />,
    );

    const splitRowOption = screen.getByRole("option", { name: /左右分栏.*同一行左 \/ 右独立输入/ });
    expect(splitRowOption.querySelector("svg")).toBeNull();
    await user.click(splitRowOption);

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "resumeRow",
      content: [{ type: "paragraph" }, { type: "paragraph" }],
    });
    expect(onClose).toHaveBeenCalledOnce();
    editor.destroy();
  });

  it("光标位于分栏行内时显示当前状态，再点一次取消分栏", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: "resumeRow",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "公司实习" }] },
            { type: "paragraph", content: [{ type: "text", text: "2025.01" }] },
          ],
        }],
      },
    });
    editor.commands.setTextSelection(2);

    render(
      <SlashCommandMenu
        editor={editor}
        resumeId="42"
        state={{ x: 10, y: 10, query: "", replaceRange: null }}
        onClose={onClose}
        onNotice={vi.fn()}
      />,
    );

    const option = screen.getByRole("option", { name: /左右分栏.*当前行 · 点击取消分栏/ });
    expect(option).toHaveAttribute("aria-current", "true");
    // 只用颜色表示当前块，不加勾选之类的额外图标。
    expect(option.querySelector("svg")).toBeNull();

    await user.click(option);

    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "paragraph" });
    expect(editor.getText()).toBe("公司实习　2025.01");
    expect(onClose).toHaveBeenCalledOnce();
    editor.destroy();
  });

  it.each([
    ["<p>正文</p>", /^正文/],
    ["<h2>章节</h2>", /标题 2/],
    ["<ul><li><p>分点</p></li></ul>", /无序列表/],
    ["<ol><li><p>编号</p></li></ol>", /有序列表/],
  ])("标题、列表与正文同样标出当前块状态：%s", (html, name) => {
    const editor = new Editor({ extensions: resumeEditorExtensions, content: html });
    let position = 2;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText) position = pos + 1;
    });
    editor.commands.setTextSelection(position);

    render(
      <SlashCommandMenu
        editor={editor}
        resumeId="42"
        state={{ x: 10, y: 10, query: "", replaceRange: null }}
        onClose={vi.fn()}
        onNotice={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name })).toHaveAttribute("aria-current", "true");
    editor.destroy();
  });
});

describe("行首图标", () => {
  it("从命令面板选择学校图标并保留后续文字与光标位置", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const editor = new Editor({
      extensions: resumeEditorExtensions,
      content: "<p>/图标示例大学</p>",
    });
    editor.commands.setTextSelection(5);

    render(
      <SlashCommandMenu
        editor={editor}
        resumeId="42"
        state={{ x: 10, y: 10, query: "图标", replaceRange: { from: 2, to: 5 } }}
        onClose={onClose}
        onNotice={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("option", { name: /插入图标/ }));
    await user.click(screen.getByRole("option", { name: "学校" }));

    const paragraph = editor.getJSON().content?.[0];
    expect(paragraph?.content?.find((node) => node.type === "inlineIcon")).toMatchObject({
      type: "inlineIcon",
      attrs: { name: "GraduationCap" },
    });
    expect(paragraph?.content?.find((node) => node.type === "text")?.text).toBe(" 示例大学");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.$from.parentOffset).toBe(3);
    expect(onClose).toHaveBeenCalledOnce();

    const markdown = editorDocumentToMarkdown(editor.getJSON());
    const restored = new Editor({ extensions: resumeEditorExtensions, content: renderResumeMarkdown(markdown) });
    expect(restored.getJSON().content?.[0]?.content?.find((node) => node.type === "inlineIcon")).toMatchObject({
      type: "inlineIcon",
      attrs: { name: "GraduationCap" },
    });
    restored.destroy();
    editor.destroy();
  });
});

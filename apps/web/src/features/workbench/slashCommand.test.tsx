import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { editorDocumentToMarkdown } from "../../api/resumeContract";
import { renderResumeMarkdown } from "../../parser/resumeMarkdown";
import { resumeEditorExtensions } from "./editorExtensions";
import { BlankLineMenuExtension, filterWorkbenchCommands, SlashCommandMenu, topLevelBlankLinePositions } from "./slashCommand";

describe("命令面板过滤", () => {
  it("支持按中文命令名和关键词过滤", () => {
    expect(filterWorkbenchCommands("分栏").map((item) => item.id)).toEqual(["resume-row"]);
    expect(filterWorkbenchCommands("h2").map((item) => item.id)).toEqual(["heading-2"]);
  });

  it("空查询展示全部块命令", () => {
    expect(filterWorkbenchCommands("").length).toBeGreaterThan(8);
    expect(filterWorkbenchCommands("")[1]).toMatchObject({ id: "resume-row", label: "左右分栏" });
  });
});

describe("空白行格式入口", () => {
  it("为每个顶层空白行提供方框加号，并能打开命令面板", () => {
    const onOpen = vi.fn();
    const editor = new Editor({
      extensions: [Document, Paragraph, Text, BlankLineMenuExtension.configure({ onOpen })],
      content: "<p></p><p>已有内容</p><p></p>",
    });

    editor.commands.setTextSelection(1);
    const buttons = editor.view.dom.querySelectorAll<HTMLButtonElement>(".resume-empty-line-add");
    const blankPositions = topLevelBlankLinePositions(editor.state);
    expect(buttons).toHaveLength(2);
    expect(blankPositions).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("在此空白行设置格式");
    expect(buttons[0]?.dataset.active).toBe("true");

    buttons[1]?.click();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ query: "", replaceRange: null }));
    expect(editor.state.selection.from).toBe(blankPositions[1]);

    editor.commands.setTextSelection(3);
    expect(editor.view.dom.querySelectorAll(".resume-empty-line-add")).toHaveLength(2);
    expect([...editor.view.dom.querySelectorAll<HTMLElement>(".resume-empty-line-add")]
      .every((button) => button.dataset.active === "false")).toBe(true);
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
});

describe("行首图标", () => {
  it("从命令面板选择学校图标并保留后续文字与光标位置", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const editor = new Editor({
      extensions: resumeEditorExtensions,
      content: "<p>/图标示例大学</p>",
    });
    editor.commands.setTextSelection(4);

    render(
      <SlashCommandMenu
        editor={editor}
        resumeId="42"
        state={{ x: 10, y: 10, query: "图标", replaceRange: { from: 1, to: 4 } }}
        onClose={onClose}
        onNotice={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("option", { name: /插入图标/ }));
    await user.click(screen.getByRole("option", { name: "学校" }));

    const paragraph = editor.getJSON().content?.[0];
    expect(paragraph?.content?.[0]).toMatchObject({ type: "inlineIcon", attrs: { name: "GraduationCap" } });
    expect(paragraph?.content?.[1]?.text).toBe(" 示例大学");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(3);
    expect(onClose).toHaveBeenCalledOnce();

    const markdown = editorDocumentToMarkdown(editor.getJSON());
    const restored = new Editor({ extensions: resumeEditorExtensions, content: renderResumeMarkdown(markdown) });
    expect(restored.getJSON().content?.[0]?.content?.[0]).toMatchObject({ type: "inlineIcon", attrs: { name: "GraduationCap" } });
    restored.destroy();
    editor.destroy();
  });
});

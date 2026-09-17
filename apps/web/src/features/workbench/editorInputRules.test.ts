import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { resumeEditorExtensions } from "./editorExtensions";

let editor: Editor;
afterEach(() => editor?.destroy());

function typeText(text: string) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const insert = () => editor.state.tr.insertText(character, from, to);
    const handled = editor.view.someProp("handleTextInput", (handler) => (
      handler(editor.view, from, to, character, insert)
    ));
    if (!handled) editor.view.dispatch(insert());
  }
}

function createEditor(content = "<p></p>") {
  editor = new Editor({ extensions: resumeEditorExtensions, content });
  // 与工作台一致，先触发定位锚点补齐，再将光标放到行末。
  editor.commands.setTextSelection(TextSelection.atStart(editor.state.doc).from);
  editor.commands.setTextSelection(editor.state.selection.$from.end());
}

describe("简历 Markdown 无序列表输入", () => {
  it.each(["-", "*", "+"])("行首 %s 加空格转换为无序列表并保留定位锚点", (marker) => {
    createEditor();
    const anchor = editor.state.selection.$from.parent.firstChild?.toJSON();
    typeText(marker);
    expect(editor.isActive("bulletList")).toBe(false);
    typeText(" ");

    expect(editor.isActive("bulletList")).toBe(true);
    expect(editor.state.selection.$from.parent.textContent).toBe("");
    expect(editor.state.selection.$from.parent.firstChild?.toJSON()).toEqual(anchor);

    typeText("列表内容");
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    expect(editor.isActive("listItem")).toBe(false);
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.firstChild?.textContent).toBe("列表内容");
  });

  it.each(["正文- ", "正文 - ", "-1 ", "2024-2026 "])("%s 保留为普通文本", (text) => {
    createEditor();
    typeText(text);
    expect(editor.isActive("bulletList")).toBe(false);
    expect(editor.state.doc.textContent).toBe(text);
  });

  it("退格撤销自动转换时恢复标记和空格", () => {
    createEditor();
    const anchor = editor.state.doc.firstChild?.firstChild?.toJSON();
    typeText("- ");
    expect(editor.commands.undoInputRule()).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.textContent).toBe("- ");
    expect(editor.state.doc.firstChild?.firstChild?.toJSON()).toEqual(anchor);
  });

  it("相邻无序列表会合并并保留两项", () => {
    createEditor("<ul><li><p>已有项</p></li></ul><p></p>");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    typeText("- 新增项");
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    expect(editor.state.doc.firstChild?.child(0).textContent).toBe("已有项");
    expect(editor.state.doc.firstChild?.child(1).textContent).toBe("新增项");
  });

  it("左右分栏内无法容纳列表时保留输入文字", () => {
    createEditor('<div data-type="resume-row"><p></p><p>右栏</p></div>');
    editor.commands.setTextSelection(3);
    typeText("- ");
    expect(editor.state.doc.firstChild?.type.name).toBe("resumeRow");
    expect(editor.state.doc.firstChild?.child(0).textContent).toBe("- ");
    expect(editor.state.doc.firstChild?.child(1).textContent).toBe("右栏");
  });
});

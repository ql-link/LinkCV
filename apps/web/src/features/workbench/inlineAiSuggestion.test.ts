import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
  InlineAiSuggestionExtension,
  applyInlineAiSuggestion,
  canStartInlineAiEdit,
  getInlineAiSuggestion,
  setInlineAiSuggestion,
} from "./inlineAiSuggestion";

const editors: Editor[] = [];

function createEditor(content = "负责核心接口建设") {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, InlineAiSuggestionExtension],
    content: `<p>${content}</p>`,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("inlineAiSuggestion", () => {
  it("预览只使用 decoration，不改变文档 JSON", () => {
    const editor = createEditor();
    editor.commands.setTextSelection({ from: 1, to: 9 });
    const before = editor.getJSON();
    const original = editor.state.doc.textBetween(1, 9, "", "\ufffc");

    expect(canStartInlineAiEdit(editor)).toBe(true);
    setInlineAiSuggestion(editor, {
      from: 1,
      to: 9,
      original,
      replacement: "主导核心接口建设",
    });

    expect(editor.getJSON()).toEqual(before);
    expect(editor.view.dom.querySelector(".resume-ai-source-hidden")).not.toBeNull();
    expect(editor.view.dom.querySelector(".resume-ai-diff-removed")).not.toBeNull();
    expect(editor.view.dom.querySelector(".resume-ai-diff-added")).not.toBeNull();
  });

  it("应用后一次替换原选区，并可一次撤销", () => {
    const editor = createEditor();
    const original = editor.state.doc.textBetween(1, 9, "", "\ufffc");
    setInlineAiSuggestion(editor, {
      from: 1,
      to: 9,
      original,
      replacement: "主导核心接口建设",
    });

    expect(applyInlineAiSuggestion(editor)).toBe(true);
    expect(editor.getText()).toBe("主导核心接口建设");
    expect(getInlineAiSuggestion(editor)).toBeNull();

    editor.commands.undo();
    expect(editor.getText()).toBe("负责核心接口建设");
  });

  it("原文被编辑后将建议标记为失效并阻止应用", () => {
    const editor = createEditor();
    const original = editor.state.doc.textBetween(1, 9, "", "\ufffc");
    setInlineAiSuggestion(editor, {
      from: 1,
      to: 9,
      original,
      replacement: "主导核心接口建设",
    });

    editor.commands.insertContentAt(4, "新");

    expect(getInlineAiSuggestion(editor)?.stale).toBe(true);
    expect(applyInlineAiSuggestion(editor)).toBe(false);
  });

  it("拒绝跨段落选区", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit, InlineAiSuggestionExtension],
      content: "<p>第一段</p><p>第二段</p>",
    });
    editors.push(editor);
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    expect(canStartInlineAiEdit(editor)).toBe(false);
  });
});

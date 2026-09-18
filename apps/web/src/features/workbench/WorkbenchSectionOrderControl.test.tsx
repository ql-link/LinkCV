import { Editor, type JSONContent } from "@tiptap/core";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { resumeEditorExtensions } from "./editorExtensions";
import {
  WorkbenchSectionOrderControl,
  WorkbenchSectionOrderReset,
  dropIndex,
} from "./WorkbenchSectionOrderControl";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const text = (value: string): JSONContent => ({ type: "text", text: value });

function heading(level: number, blockId: string, semanticKind: string | null, title: string): JSONContent {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "resumeBlockAnchor", attrs: { blockId, semanticKind } }, text(title)],
  };
}

const content: JSONContent = {
  type: "doc",
  content: [
    heading(1, "blk_identity0000000000", null, "许乐乐"),
    heading(2, "blk_education00000000", "education", "教育经历"),
    heading(2, "blk_skills00000000000", "skills", "专业技能"),
  ],
};

function setup() {
  editor = new Editor({ extensions: resumeEditorExtensions, content });
  render(<WorkbenchSectionOrderControl editor={editor} />);
  return editor;
}

function rowTitles() {
  return screen.getAllByRole("listitem").map((row) => within(row).getByText(/.+/).textContent);
}

function sectionTitles(instance: Editor) {
  return (instance.getJSON().content ?? []).slice(1).map((node) => {
    const content = node.content ?? [];
    return content[content.length - 1]?.text ?? "";
  });
}

describe("WorkbenchSectionOrderControl", () => {
  it("按当前顺序展示模块，并把个人信息渲染为固定行", () => {
    setup();

    expect(rowTitles()).toEqual(["个人信息", "教育经历", "专业技能"]);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveAttribute("draggable", "false");
    expect(rows[1]).toHaveAttribute("draggable", "true");
    expect(screen.queryByRole("button", { name: /调整「个人信息」/ })).not.toBeInTheDocument();
  });

  it("用上下方向键移动模块并立即改写编辑器顺序", async () => {
    const user = userEvent.setup();
    const instance = setup();

    await user.click(screen.getByRole("button", { name: /调整「专业技能」顺序/ }));
    await user.keyboard("{ArrowUp}");

    expect(rowTitles()).toEqual(["个人信息", "专业技能", "教育经历"]);
    expect(sectionTitles(instance)).toEqual(["专业技能", "教育经历"]);
  });

  it("第一项不能继续上移", async () => {
    const user = userEvent.setup();
    const instance = setup();
    const before = instance.getJSON();

    await user.click(screen.getByRole("button", { name: /调整「教育经历」顺序/ }));
    await user.keyboard("{ArrowUp}");

    expect(rowTitles()).toEqual(["个人信息", "教育经历", "专业技能"]);
    expect(instance.getJSON()).toEqual(before);
  });

  it("禁用时不能拖动，也不提供手柄", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content });
    render(<WorkbenchSectionOrderControl editor={editor} disabled />);

    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("draggable", "false");
    expect(screen.getByRole("button", { name: /调整「专业技能」顺序/ })).toBeDisabled();
  });

  it("编辑器顺序变化后控件跟随刷新", () => {
    const instance = setup();
    expect(rowTitles()).toEqual(["个人信息", "教育经历", "专业技能"]);

    const json = instance.getJSON();
    const sections = (json.content ?? []).slice(1);
    act(() => {
      instance.commands.setContent({ type: "doc", content: [json.content![0], sections[1], sections[0]] });
    });

    expect(rowTitles()).toEqual(["个人信息", "专业技能", "教育经历"]);
  });
});

describe("WorkbenchSectionOrderReset", () => {
  it("把顺序恢复为规范章节顺序", async () => {
    const user = userEvent.setup();
    editor = new Editor({ extensions: resumeEditorExtensions, content });
    render(<WorkbenchSectionOrderReset editor={editor} />);

    const json = editor.getJSON();
    const sections = (json.content ?? []).slice(1);
    editor.commands.setContent({ type: "doc", content: [json.content![0], sections[1], sections[0]] });

    await user.click(screen.getByRole("button", { name: "恢复默认" }));

    expect(sectionTitles(editor)).toEqual(["教育经历", "专业技能"]);
  });

  it("禁用时不可点击", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content });
    render(<WorkbenchSectionOrderReset editor={editor} disabled />);

    expect(screen.getByRole("button", { name: "恢复默认" })).toBeDisabled();
  });
});

describe("WorkbenchSectionOrderControl 拖放", () => {
  it("按落点上下半区换算出目标下标", () => {
    // 把第 3 行拖到第 2 行上方 / 下方。
    expect(dropIndex(1, "before", 2)).toBe(1);
    expect(dropIndex(1, "after", 2)).toBe(2);
    // 把第 2 行拖到第 3 行上方 / 下方。
    expect(dropIndex(2, "before", 1)).toBe(1);
    expect(dropIndex(2, "after", 1)).toBe(2);
  });

  it("可拖动行声明 draggable，固定行与禁用态不可拖动", () => {
    setup();
    const rows = screen.getAllByRole("listitem");

    expect(rows.slice(1).every((row) => row.getAttribute("draggable") === "true")).toBe(true);
    expect(rows[0]).toHaveAttribute("draggable", "false");
  });
});

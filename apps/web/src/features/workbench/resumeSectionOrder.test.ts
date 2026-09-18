import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { resumeEditorExtensions } from "./editorExtensions";
import {
  applySectionOrder,
  defaultSectionOrder,
  moveSectionItem,
  resetSectionOrder,
  resumeSectionOrderGroups,
} from "./resumeSectionOrder";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const text = (value: string): JSONContent => ({ type: "text", text: value });

const anchor = (blockId: string, semanticKind: string | null): JSONContent => ({
  type: "resumeBlockAnchor",
  attrs: { blockId, semanticKind },
});

function heading(level: number, blockId: string, semanticKind: string | null, title: string): JSONContent {
  return {
    type: "heading",
    attrs: { level },
    content: [anchor(blockId, semanticKind), text(title)],
  };
}

function paragraph(value: string): JSONContent {
  return { type: "paragraph", attrs: { textAlign: null }, content: [text(value)] };
}

const singleColumn: JSONContent = {
  type: "doc",
  content: [
    heading(1, "blk_identity0000000000", null, "许乐乐"),
    paragraph("13170053237"),
    heading(2, "blk_education00000000", "education", "教育经历"),
    paragraph("安徽工业大学"),
    heading(2, "blk_skills00000000000", "skills", "专业技能"),
    paragraph("Java"),
  ],
};

const twoColumn: JSONContent = {
  type: "doc",
  content: [
    {
      type: "resumeColumns",
      content: [
        {
          type: "resumeColumn",
          attrs: { variant: "sidebar" },
          content: [
            heading(2, "blk_skills00000000000", "skills", "专业技能"),
            paragraph("Java"),
          ],
        },
        {
          type: "resumeColumn",
          attrs: { variant: "main" },
          content: [
            heading(1, "blk_identity0000000000", null, "许乐乐"),
            heading(2, "blk_education00000000", "education", "教育经历"),
            paragraph("安徽工业大学"),
            heading(2, "blk_work0000000000000", "work", "实习经历"),
            paragraph("禾赛科技"),
          ],
        },
      ],
    },
  ],
};

function lastText(node: JSONContent) {
  const content = node.content ?? [];
  return content[content.length - 1]?.text ?? "";
}

function topLevelOrder(value: Editor) {
  return (value.getJSON().content ?? []).map((node) => (
    node.type === "heading" ? lastText(node) : node.type
  ));
}

describe("resumeSectionOrderGroups", () => {
  it("单栏文档给出一个分组，含固定的个人信息行", () => {
    const groups = resumeSectionOrderGroups(singleColumn);

    expect(groups).toHaveLength(1);
    expect(groups[0].side).toBeNull();
    expect(groups[0].label).toBeNull();
    expect(groups[0].items).toEqual([
      { nodeId: null, title: "个人信息", kind: "identity" },
      { nodeId: "blk_education00000000", title: "教育经历", kind: "education" },
      { nodeId: "blk_skills00000000000", title: "专业技能", kind: "skills" },
    ]);
  });

  it("双栏文档按左右栏分组，个人信息跟随所在栏", () => {
    const groups = resumeSectionOrderGroups(twoColumn);

    expect(groups.map((group) => [group.side, group.label])).toEqual([
      ["sidebar", "左栏"],
      ["main", "右栏"],
    ]);
    expect(groups[0].items.map((item) => item.title)).toEqual(["专业技能"]);
    expect(groups[1].items.map((item) => item.title)).toEqual(["个人信息", "教育经历", "实习经历"]);
  });

  it("没有分栏时忽略没有锚点的标题", () => {
    const groups = resumeSectionOrderGroups({
      type: "doc",
      content: [
        heading(2, "blk_skills00000000000", "skills", "专业技能"),
        { type: "heading", attrs: { level: 2 }, content: [text("无锚点标题")] },
      ],
    });

    expect(groups[0].items).toEqual([
      { nodeId: "blk_skills00000000000", title: "专业技能", kind: "skills" },
    ]);
  });
});

describe("模块顺序排序助手", () => {
  it("moveSectionItem 按目标位置移动并在越界时保持不变", () => {
    expect(moveSectionItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveSectionItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveSectionItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveSectionItem(["a", "b", "c"], 0, 9)).toEqual(["a", "b", "c"]);
  });

  it("defaultSectionOrder 使用规范章节顺序", () => {
    const ordered = defaultSectionOrder([
      { kind: "skills" as const, id: "skills" },
      { kind: "education" as const, id: "education" },
      { kind: "work" as const, id: "work" },
      { kind: "profile" as const, id: "profile" },
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["profile", "work", "education", "skills"]);
  });
});

describe("applySectionOrder", () => {
  it("在单栏文档中把选中的模块移动到目标位置", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: singleColumn });
    expect(topLevelOrder(editor)).toEqual(["许乐乐", "paragraph", "教育经历", "paragraph", "专业技能", "paragraph"]);

    expect(applySectionOrder(editor, null, ["blk_skills00000000000", "blk_education00000000"])).toBe(true);

    expect(topLevelOrder(editor)).toEqual(["许乐乐", "paragraph", "专业技能", "paragraph", "教育经历", "paragraph"]);
    expect(resumeSectionOrderGroups(editor.getJSON())[0].items.map((item) => item.title))
      .toEqual(["个人信息", "专业技能", "教育经历"]);
  });

  it("只重排目标栏，另一栏保持原样", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: twoColumn });

    expect(applySectionOrder(editor, "main", ["blk_work0000000000000", "blk_education00000000"])).toBe(true);

    const groups = resumeSectionOrderGroups(editor.getJSON());
    expect(groups[0].items.map((item) => item.title)).toEqual(["专业技能"]);
    expect(groups[1].items.map((item) => item.title)).toEqual(["个人信息", "实习经历", "教育经历"]);
  });

  it("拒绝与当前模块不匹配的重排请求", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: singleColumn });
    const before = editor.getJSON();

    expect(applySectionOrder(editor, null, ["blk_skills00000000000"])).toBe(false);
    expect(applySectionOrder(editor, null, ["blk_skills00000000000", "blk_unknown000000000"])).toBe(false);
    expect(applySectionOrder(editor, "sidebar", ["blk_skills00000000000", "blk_education00000000"])).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });

  it("resetSectionOrder 恢复规范顺序", () => {
    editor = new Editor({ extensions: resumeEditorExtensions, content: singleColumn });
    applySectionOrder(editor, null, ["blk_skills00000000000", "blk_education00000000"]);

    expect(resetSectionOrder(editor)).toBe(true);
    expect(resumeSectionOrderGroups(editor.getJSON())[0].items.map((item) => item.title))
      .toEqual(["个人信息", "教育经历", "专业技能"]);
    expect(resetSectionOrder(editor)).toBe(false);
  });
});

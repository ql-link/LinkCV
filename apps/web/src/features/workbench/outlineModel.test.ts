import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { resumeEditorExtensions } from "./editorExtensions";
import {
  IDENTITY_KEY,
  availableModuleOptions,
  deleteOutlineSection,
  insertOutlineSection,
  outlineSectionRuns,
  outlineSectionSummary,
  outlineSnapshot,
  renameOutlineSection,
} from "./outlineModel";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const text = (value: string): JSONContent => ({ type: "text", text: value });
const paragraph = (value?: string): JSONContent => ({ type: "paragraph", content: value ? [text(value)] : [] });
const row = (left: string, right: string): JSONContent => ({
  type: "resumeRow",
  attrs: { leftWidth: 65 },
  content: [paragraph(left), paragraph(right)],
});
const list = (...items: string[]): JSONContent => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
});

function heading(level: number, blockId: string, semanticKind: string | null, title: string): JSONContent {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "resumeBlockAnchor", attrs: { blockId, semanticKind } }, text(title)],
  };
}

// 虚构简历：只用于测试大纲摘要
const content: JSONContent = {
  type: "doc",
  content: [
    heading(1, "node_identity00000000000", null, "林知远"),
    paragraph("138 0000 0000 ｜ linzhiyuan@example.com ｜ github.com/linzhiyuan"),
    heading(2, "node_education0000000000", "education", "教育经历"),
    row("示例大学 · 软件工程 · 硕士", "2021.09 – 2024.06"),
    row("示例学院 · 计算机科学 · 本科", "2017.09 – 2021.06"),
    heading(2, "node_work000000000000000", "work", "工作经历"),
    row("星河云科技 · 后端开发", "2024.07 – 至今"),
    list("重构任务调度服务。", "建设统一限流组件。"),
    heading(2, "node_skills0000000000000", "skills", "专业技能"),
    list("Go / Java", "MySQL / Redis"),
    heading(2, "node_awards0000000000000", "awards", "获奖证书"),
    paragraph(),
  ],
};

function setup() {
  editor = new Editor({ extensions: resumeEditorExtensions, content });
  return editor;
}

function titles(instance: Editor) {
  return outlineSectionRuns(instance.state.doc).map((run) => (run.kind === "identity" ? "个人信息" : run.nodes[0].textContent));
}

describe("大纲 V2 模块摘要", () => {
  it("按段数、要点数、学历和联系方式生成一行摘要", () => {
    const instance = setup();
    const summaries = Object.fromEntries(
      outlineSectionRuns(instance.state.doc).map((run) => [run.key, outlineSectionSummary(run)]),
    );

    expect(summaries[IDENTITY_KEY]).toEqual({ type: "identity", contacts: ["phone", "email", "github"] });
    expect(summaries.node_education0000000000).toEqual({ type: "entries", entries: 2, bullets: 0, degrees: ["硕士", "本科"] });
    expect(summaries.node_work000000000000000).toEqual({ type: "entries", entries: 1, bullets: 2, degrees: [] });
    expect(summaries.node_skills0000000000000).toEqual({ type: "bullets", bullets: 2 });
    expect(summaries.node_awards0000000000000).toEqual({ type: "empty" });
  });

  it("没有分页断点时所有模块都在第 1 页，并识别光标所在模块", () => {
    const instance = setup();
    const skills = outlineSectionRuns(instance.state.doc).find((run) => run.key === "node_skills0000000000000");
    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.near(instance.state.doc.resolve(skills!.from + 3))));

    const snapshot = outlineSnapshot(instance.state);
    expect(snapshot.pageCount).toBe(1);
    expect([...snapshot.info.values()].every((item) => item.page === 1)).toBe(true);
    expect(snapshot.currentKey).toBe("node_skills0000000000000");
  });
});

describe("大纲 V2 行操作", () => {
  it("重命名只改标题文字，保留 blockId", () => {
    const instance = setup();
    expect(renameOutlineSection(instance, "node_skills0000000000000", "技能清单")).toBe(true);

    const run = outlineSectionRuns(instance.state.doc).find((item) => item.key === "node_skills0000000000000");
    expect(run?.nodes[0].textContent).toBe("技能清单");
    expect(renameOutlineSection(instance, "node_skills0000000000000", "  ")).toBe(false);
  });

  it("删除模块连同其下内容一起移除", () => {
    const instance = setup();
    expect(deleteOutlineSection(instance, "node_work000000000000000")).toBe(true);
    expect(titles(instance)).toEqual(["个人信息", "教育经历", "专业技能", "获奖证书"]);
    expect(instance.state.doc.textContent).not.toContain("星河云科技");
  });

  it("添加模块插到光标所在模块之后并带上 semanticKind", () => {
    const instance = setup();
    const education = outlineSectionRuns(instance.state.doc).find((run) => run.key === "node_education0000000000");
    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.near(instance.state.doc.resolve(education!.from + 3))));

    const blockId = insertOutlineSection(instance, "profile", "个人总结");
    expect(blockId).toMatch(/^node_/u);
    expect(titles(instance)).toEqual(["个人信息", "教育经历", "个人总结", "工作经历", "专业技能", "获奖证书"]);
    const inserted = outlineSectionRuns(instance.state.doc).find((run) => run.key === blockId);
    expect(inserted?.kind).toBe("profile");
  });

  it("只列出文档里还没有的常用模块", () => {
    const instance = setup();
    const present = new Set(outlineSectionRuns(instance.state.doc).map((run) => run.kind));
    const kinds = availableModuleOptions(present).map((option) => option.kind);
    expect(kinds).not.toContain("education");
    expect(kinds).toContain("profile");
    expect(kinds).toContain("languages");
  });
});

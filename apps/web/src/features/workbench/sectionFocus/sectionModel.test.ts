import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { resumeEditorExtensions } from "../editorExtensions";
import {
  contextPayload,
  currentLineText,
  editableLineIds,
  focusUnitsFromDoc,
  lineIndexFromText,
  matchTarget,
  replaceLineText,
  sectionPayload,
} from "./sectionModel";

const anchor = (blockId: string, role: string): JSONContent => ({ type: "resumeBlockAnchor", attrs: { blockId, role } });
const heading = (level: number, anchors: JSONContent[], text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [...anchors, { type: "text", text }],
});
const bullet = (id: string, text: string): JSONContent => ({
  type: "listItem",
  content: [{ type: "paragraph", content: [anchor(id, "list-item"), { type: "text", text }] }],
});

const doc: JSONContent = {
  type: "doc",
  content: [
    heading(2, [anchor("node_sectionwork00000001", "section")], "工作经历"),
    heading(3, [anchor("node_entrymeituan000001", "entry")], "美团 · 基础研发平台"),
    { type: "paragraph", content: [anchor("node_fieldrole000000001", "entry-field"), { type: "text", text: "角色：后端开发工程师" }] },
    {
      type: "bulletList",
      content: [
        bullet("node_lineone0000000001", "负责配送调度服务的 Go 微服务改造，拆分单体模块。"),
        bullet("node_linetwo0000000001", "参与限流熔断组件的开发和维护工作，保障系统稳定。"),
      ],
    },
    heading(2, [anchor("node_sectionproj00000001", "section")], "项目经历"),
    heading(3, [anchor("node_entrysched00000001", "entry")], "分布式任务调度平台"),
    { type: "bulletList", content: [bullet("node_linesched000000001", "负责调度核心模块设计。")] },
    heading(2, [anchor("node_sectionskill0000001", "section")], "专业技能"),
    { type: "paragraph", content: [anchor("node_skillline00000001", "section-block"), { type: "text", text: "Go / Java / Python" }] },
  ],
};

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeEditor(content: JSONContent = doc) {
  editor = new Editor({ extensions: resumeEditorExtensions, content });
  return editor;
}

describe("focusUnitsFromDoc", () => {
  it("groups lines under entries and treats entry-less sections as units", () => {
    const units = focusUnitsFromDoc(makeEditor().state.doc);
    expect(units.map((unit) => [unit.kind, unit.heading])).toEqual([
      ["entry", "美团 · 基础研发平台"],
      ["entry", "分布式任务调度平台"],
      ["section", "专业技能"],
    ]);
    expect(units[0].sectionLabel).toBe("工作经历");
    expect(units[0].meta).toEqual(["角色：后端开发工程师"]);
    expect(units[0].lines.map((line) => line.id)).toEqual(["node_lineone0000000001", "node_linetwo0000000001"]);
    expect(units[2].lines[0].text).toBe("Go / Java / Python");
  });

  it("builds bounded request payloads", () => {
    const units = focusUnitsFromDoc(makeEditor().state.doc);
    const section = sectionPayload(units[0]);
    expect(section.entry_id).toBe("node_entrymeituan000001");
    expect(section.heading).toBe("美团 · 基础研发平台 · 角色：后端开发工程师");
    const context = contextPayload(units, [units[1].id, "missing"]);
    expect(context).toEqual([{ id: units[1].id, label: "项目经历 · 分布式任务调度平台", text: "分布式任务调度平台\n负责调度核心模块设计。" }]);
  });
});

describe("matchTarget", () => {
  it("finds a unique entry from a sentence", () => {
    const units = focusUnitsFromDoc(makeEditor().state.doc);
    const match = matchTarget("帮我改一下美团那段，突出技术深度", units);
    expect(match.kind).toBe("unique");
    expect(match.kind === "unique" && match.unit.heading).toBe("美团 · 基础研发平台");
  });

  it("asks the user to pick when nothing matches", () => {
    const units = focusUnitsFromDoc(makeEditor().state.doc);
    const match = matchTarget("帮我改一下字节那段", units);
    expect(match.kind).toBe("none");
  });
});

describe("lineIndexFromText", () => {
  it("reads arabic and chinese ordinals", () => {
    expect(lineIndexFromText("第 2 条写得更有冲击力")).toBe(1);
    expect(lineIndexFromText("第三条再精简一点")).toBe(2);
    expect(lineIndexFromText("整体更精简")).toBeNull();
  });
});

describe("replaceLineText", () => {
  it("keeps the anchor and replaces only the visible text", () => {
    const current = makeEditor();
    const tr = replaceLineText(current.state, "node_linetwo0000000001", "参与限流熔断组件的开发和维护工作，保障系统稳定。", "参与开发限流与熔断组件。");
    expect(typeof tr).not.toBe("string");
    if (typeof tr !== "string") current.view.dispatch(tr);
    expect(currentLineText(current.state.doc, "node_linetwo0000000001")).toBe("参与开发限流与熔断组件。");
  });

  it("refuses to overwrite a line that changed since the review", () => {
    const current = makeEditor();
    expect(replaceLineText(current.state, "node_lineone0000000001", "旧文本", "新文本")).toBe("conflict");
    expect(replaceLineText(current.state, "node_unknown0000000001", "", "x")).toBe("missing");
  });

  it("keeps an anchor that sits after the text", () => {
    const current = makeEditor({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "旧的一句" }, anchor("node_linemiddle00000001", "block")],
      }],
    });
    const tr = replaceLineText(current.state, "node_linemiddle00000001", "旧的一句", "新的一句");
    expect(typeof tr).not.toBe("string");
    if (typeof tr !== "string") current.view.dispatch(tr);
    expect(currentLineText(current.state.doc, "node_linemiddle00000001")).toBe("新的一句");
  });
});

describe("editableLineIds", () => {
  it("excludes lines that would be truncated or are past the line limit", () => {
    const lines = Array.from({ length: 22 }, (_, index) => ({ id: `line-${index}`, text: index === 1 ? "长".repeat(501) : "短句" }));
    const unit = { id: "u", kind: "entry" as const, sectionLabel: "", heading: "", meta: [], lines, from: 0, to: 0 };
    const ids = editableLineIds(unit);
    expect(ids.has("line-0")).toBe(true);
    expect(ids.has("line-1")).toBe(false);
    expect(ids.has("line-19")).toBe(true);
    expect(ids.has("line-20")).toBe(false);
  });
});

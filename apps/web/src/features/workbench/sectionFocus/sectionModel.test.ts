import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { resumeEditorExtensions } from "../editorExtensions";
import {
  contextPayload,
  currentLineText,
  editableLineIds,
  focusUnitsFromDoc,
  headerParts,
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

describe("header-row experiences", () => {
  const cell = (anchors: JSONContent[], text: string): JSONContent => ({ type: "paragraph", content: [...anchors, { type: "text", text }] });
  const row = (id: string, cells: string[]): JSONContent => ({
    type: "resumeRow",
    content: cells.map((text, index) => cell([
      ...(index === 0 ? [anchor(`node_row${id}0000000000000`, "row")] : []),
      anchor(`node_cell${id}${index}00000000000`, "row-cell"),
      anchor(`node_blk${id}${index}000000000000`, "row-block"),
    ], text)),
  });
  const rowDoc: JSONContent = {
    type: "doc",
    content: [
      heading(2, [anchor("node_sectionintern000001", "section")], "实习经历"),
      row("a", ["2023.06 - 2023.09", "星野零售科技有限公司", "用户运营", "运营实习生"]),
      { type: "bulletList", content: [bullet("node_lineintern00000001", "维护商品信息与活动排期。"), bullet("node_lineintern00000002", "分析访问与购买漏斗。")] },
      row("b", ["2022.07 - 2022.10", "澄海内容科技有限公司", "内容社区", "运营实习生"]),
      { type: "bulletList", content: [bullet("node_lineintern00000003", "完成内容审核与用户互动。")] },
    ],
  };

  it("splits each header row and its bullets into its own unit", () => {
    const units = focusUnitsFromDoc(makeEditor(rowDoc).state.doc);
    expect(units.map((unit) => [unit.kind, unit.sectionLabel, unit.heading, unit.lines.length])).toEqual([
      ["entry", "实习经历", "星野零售科技有限公司", 2],
      ["entry", "实习经历", "澄海内容科技有限公司", 1],
    ]);
    expect(headerParts(units[0])).toEqual({ dates: ["2023.06 - 2023.09"], details: ["用户运营", "运营实习生"] });
    expect(units[0].to).toBeLessThan(units[1].from);
  });

  it("recognises header rows whose anchors carry no role", () => {
    const bare = (id: string, cells: string[]): JSONContent => ({
      type: "resumeRow",
      content: cells.map((text, index) => ({
        type: "paragraph",
        content: [{ type: "resumeBlockAnchor", attrs: { blockId: `node_bare${id}${index}0000000000`, role: null } }, { type: "text", text }],
      })),
    });
    const units = focusUnitsFromDoc(makeEditor({
      type: "doc",
      content: [
        heading(2, [anchor("node_sectionintern000002", "section")], "实习经历"),
        bare("a", ["2023.06 - 2023.09", "星野零售科技有限公司"]),
        { type: "bulletList", content: [bullet("node_lineintern00000011", "维护商品信息与活动排期。")] },
        bare("b", ["2022.07 - 2022.10", "澄海内容科技有限公司"]),
        { type: "bulletList", content: [bullet("node_lineintern00000012", "完成内容审核与用户互动。")] },
      ],
    }).state.doc);
    expect(units.map((unit) => [unit.heading, unit.meta, unit.lines.length])).toEqual([
      ["星野零售科技有限公司", ["2023.06 - 2023.09"], 1],
      ["澄海内容科技有限公司", ["2022.07 - 2022.10"], 1],
    ]);
  });
});

describe("experiences without their own titles", () => {
  const row = (id: string, cells: string[]): JSONContent => ({
    type: "resumeRow",
    content: cells.map((text, index) => ({
      type: "paragraph",
      content: [anchor(`node_cell${id}${index}00000000000`, "row-cell"), { type: "text", text }],
    })),
  });

  it("splits two internships that share one untitled entry", () => {
    const units = focusUnitsFromDoc(makeEditor({
      type: "doc",
      content: [
        heading(2, [anchor("node_sectionintern000003", "section")], "实习经历"),
        { type: "heading", attrs: { level: 3 }, content: [anchor("node_entryuntitled00001", "entry")] },
        row("a", ["2023.06 - 2023.09", "星野零售科技有限公司", "用户运营", "运营实习生"]),
        { type: "bulletList", content: [bullet("node_lineintern00000021", "维护商品信息与活动排期。"), bullet("node_lineintern00000022", "分析访问与购买漏斗。")] },
        row("b", ["2022.07 - 2022.10", "澄海内容科技有限公司", "内容社区", "运营实习生"]),
        { type: "bulletList", content: [bullet("node_lineintern00000023", "完成内容审核与用户互动。")] },
      ],
    }).state.doc);
    expect(units.map((unit) => [unit.id, unit.heading, headerParts(unit).dates, unit.lines.length])).toEqual([
      ["node_entryuntitled00001", "星野零售科技有限公司", ["2023.06 - 2023.09"], 2],
      ["node_cellb000000000000", "澄海内容科技有限公司", ["2022.07 - 2022.10"], 1],
    ]);
  });

  it("treats a plain「date  company  role」line as a header", () => {
    const block = (id: string, text: string): JSONContent => ({ type: "paragraph", content: [anchor(id, "section-block"), { type: "text", text }] });
    const units = focusUnitsFromDoc(makeEditor({
      type: "doc",
      content: [
        heading(2, [anchor("node_sectionintern000004", "section")], "实习经历"),
        block("node_headintern00000001", "2023.06 - 2023.09  星野零售科技有限公司  运营实习生"),
        { type: "bulletList", content: [bullet("node_lineintern00000031", "维护商品信息与活动排期。")] },
        block("node_headintern00000002", "2022.07 - 2022.10 | 澄海内容科技有限公司 | 运营实习生"),
        { type: "bulletList", content: [bullet("node_lineintern00000032", "完成内容审核与用户互动。")] },
        heading(2, [anchor("node_sectionedu000000009", "section")], "教育背景"),
        block("node_eduline000000000001", "示例大学 · 信息管理 · 2019.09 - 2023.06，主修统计学。"),
      ],
    }).state.doc);
    expect(units.map((unit) => [unit.heading, unit.meta, unit.lines.length])).toEqual([
      ["星野零售科技有限公司", ["2023.06 - 2023.09", "运营实习生"], 1],
      ["澄海内容科技有限公司", ["2022.07 - 2022.10", "运营实习生"], 1],
      ["教育背景", [], 1],
    ]);
  });
});

describe("experiences in any section", () => {
  const block = (id: string, text: string): JSONContent => ({ type: "paragraph", content: [anchor(id, "section-block"), { type: "text", text }] });
  const units = (content: JSONContent[]) => focusUnitsFromDoc(makeEditor({ type: "doc", content }).state.doc);

  it("splits schools, including date formats with years only or 年月", () => {
    const result = units([
      heading(2, [anchor("node_sectionedu000000011", "section")], "教育经历"),
      block("node_eduhead00000000001", "示例大学 计算机科学与技术 硕士 2021年9月 - 2024年6月"),
      { type: "bulletList", content: [bullet("node_eduline00000000011", "研究方向为推荐系统。")] },
      block("node_eduhead00000000002", "样例理工学院 · 软件工程 · 本科 · 2017 - 2021"),
      { type: "bulletList", content: [bullet("node_eduline00000000012", "专业排名前 10%。")] },
    ]);
    expect(result.map((unit) => [unit.heading, headerParts(unit).dates, unit.lines.length])).toEqual([
      ["示例大学 计算机科学与技术 硕士", ["2021年9月 - 2024年6月"], 1],
      ["样例理工学院", ["2017 - 2021"], 1],
    ]);
  });

  it("does not merge two headers that each carry their own dates", () => {
    const result = units([
      heading(2, [anchor("node_sectionedu000000012", "section")], "教育经历"),
      { type: "heading", attrs: { level: 3 }, content: [anchor("node_entryuntitled00002", "entry")] },
      block("node_eduhead00000000003", "2021.09 - 2024.06  示例大学  硕士"),
      block("node_eduhead00000000004", "2017.09 - 2021.06  样例理工学院  本科"),
      { type: "bulletList", content: [bullet("node_eduline00000000013", "获校级奖学金两次。")] },
    ]);
    expect(result.map((unit) => [unit.heading, unit.lines.length])).toEqual([["样例理工学院", 1]]);
  });

  it("takes a project name on the line above the dates as the title", () => {
    const result = units([
      heading(2, [anchor("node_sectionlab000000001", "section")], "科研经历"),
      block("node_labtitle0000000001", "基于图结构的推荐算法研究"),
      block("node_labhead00000000001", "2021.03 - 2022.01  课题负责人"),
      { type: "bulletList", content: [bullet("node_labline00000000001", "设计并实现召回模型。")] },
      block("node_labtitle0000000002", "多模态内容理解研究"),
      block("node_labhead00000000002", "Mar 2022 – Present  研究助理"),
      { type: "bulletList", content: [bullet("node_labline00000000002", "整理标注数据集。")] },
    ]);
    expect(result.map((unit) => [unit.heading, unit.meta, unit.lines.map((line) => line.text)])).toEqual([
      ["基于图结构的推荐算法研究", ["2021.03 - 2022.01", "课题负责人"], ["设计并实现召回模型。"]],
      ["多模态内容理解研究", ["Mar 2022 – Present", "研究助理"], ["整理标注数据集。"]],
    ]);
  });
});

describe("entry header facts", () => {
  const block = (id: string, text: string): JSONContent => ({ type: "paragraph", content: [anchor(id, "entry-block"), { type: "text", text }] });
  it("moves short facts under the title into the header only when real lines remain", () => {
    const units = focusUnitsFromDoc(makeEditor({
      type: "doc",
      content: [
        heading(2, [anchor("node_sectionwork00000009", "section")], "工作经历"),
        heading(3, [anchor("node_entryyunshan000001", "entry")], "云杉协作科技有限公司"),
        block("node_blockdate000000001", "2022.07 — 至今"),
        block("node_blockrole000000001", "高级产品经理"),
        { type: "bulletList", content: [bullet("node_lineyunshan000001", "负责企业协作平台季度路线图，梳理审批与权限需求。")] },
        heading(2, [anchor("node_sectionskill0000001", "section")], "专业技能"),
        heading(3, [anchor("node_entryskill00000001", "entry")], "产品规划"),
        block("node_blockskill00000001", "需求分析、优先级管理、路线图"),
      ],
    }).state.doc);
    expect(units.map((unit) => [unit.heading, unit.meta, unit.lines.map((line) => line.text)])).toEqual([
      ["云杉协作科技有限公司", ["2022.07 — 至今", "高级产品经理"], ["负责企业协作平台季度路线图，梳理审批与权限需求。"]],
      ["产品规划", [], ["需求分析、优先级管理、路线图"]],
    ]);
  });
});


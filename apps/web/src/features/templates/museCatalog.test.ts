/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { museCatalog, museThemes } from "../../api/museThemes";
import {
  styleToEditorSettings,
  type CanonicalResumeDocument,
  type CanonicalResumePresentation,
  type LayoutPlan,
  type TemplateDefinition,
} from "../../api/resumeContract";
import { renderResumePrintDocument } from "../preview/print/resumePrintDocument";
import {
  canonicalResumeDocumentFromEditorDocument,
  canonicalResumeDocumentToEditorDocument,
} from "../workbench/resumeEditorPersistence";
import { composeEditorDocumentForLayoutPlan } from "../workbench/templateLayout";

const sql = readFileSync(resolve(process.cwd(), "../backend/migrations/sql/0100.up.sql"), "utf8");
const samples = new Map([...sql.matchAll(/SET @muse_sample_(\w+) = CAST\('((?:[^']|'')*)' AS JSON\)/g)]
  .map((match) => [match[1], JSON.parse(match[2].replace(/''/g, "'")) as CanonicalResumeDocument]));
const catalog = [...sql.matchAll(/VALUES \('(muse-[a-z]+-cn)', '(?:[^']|'')*', '(?:[^']|'')*', @muse_sample_(\w+), CAST\('((?:[^']|'')*)' AS JSON\)/g)]
  .map((match) => ({
    theme: match[1].replace(/-cn$/, ""),
    data: samples.get(match[2])!,
    template: JSON.parse(match[3].replace(/''/g, "'")) as TemplateDefinition,
  }));

function presentation(template: TemplateDefinition): CanonicalResumePresentation {
  return { schema_version: "resume-presentation.v1", portable: {}, template_scoped: {}, template_snapshot: template };
}

// A deterministic backend-plan fixture; production routing remains in FastAPI.
function layout(data: CanonicalResumeDocument, template: TemplateDefinition): LayoutPlan {
  const nodes = [{ node_id: data.identity.node_id, semantic_kind: "identity" as const }, ...data.sections];
  const placements = nodes.map(({ node_id, semantic_kind }) => {
    const slot = template.slots.find((candidate) => !candidate.universal_fallback && candidate.accepts.includes(semantic_kind))
      ?? template.slots.find((candidate) => candidate.universal_fallback)!;
    return { node_id, semantic_kind, region_id: slot.region_id, slot_id: slot.slot_id };
  });
  return {
    schema_version: "layout-plan.v1", content_sha256: `sha256:${"2".repeat(64)}`, template_key: template.template_key,
    regions: template.regions.map(({ region_id, order }) => ({ region_id, order, nodes: placements.filter((node) => node.region_id === region_id) })),
  };
}

function visibleText(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data.flatMap(visibleText);
  const value = data as Record<string, unknown>;
  if (typeof value.value === "string") return [value.value];
  if (value.inline_type === "text" && typeof value.text === "string") return [value.text];
  return Object.values(value).flatMap(visibleText);
}

describe("Muse production catalog", () => {
  it("ships the selected 79 unique sources with matching registered theme keys", () => {
    expect(catalog).toHaveLength(79);
    expect(new Set(museCatalog.map(({ source }) => source)).size).toBe(79);
    expect(new Set(catalog.map(({ theme }) => theme))).toEqual(new Set(museThemes));
    for (const theme of museThemes) {
      expect(museThemes.filter((candidate) => `${theme}-cn`.startsWith(candidate))).toEqual([theme]);
    }
  });

  it.each(catalog)("$theme renders all sample text and reverses the editor projection", ({ theme, data, template }) => {
    const style = presentation(template);
    const plan = layout(data, template);
    expect(styleToEditorSettings(style).theme).toBe(theme);
    expect(styleToEditorSettings(style).smartOnePage).toBe(false);
    const html = renderResumePrintDocument({ title: "虚构模板预览", data, style, layout_plan: plan });
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(root.querySelector(`.theme-${theme}`)).not.toBeNull();
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect(root.querySelectorAll("h2")).toHaveLength(data.sections.length);
    expect(root.querySelectorAll(".resume-avatar")).toHaveLength(template.avatar.visibility === "show" ? 1 : 0);
    for (const value of visibleText(data)) expect(root.textContent).toContain(value);
    const projected = composeEditorDocumentForLayoutPlan(canonicalResumeDocumentToEditorDocument(data), data, plan, template);
    const restored = canonicalResumeDocumentFromEditorDocument(projected, data);
    expect(visibleText(restored)).toEqual(visibleText(data));
    expect(restored.sections.map(({ node_id }) => node_id)).toEqual(data.sections.map(({ node_id }) => node_id));
  });

  it.each(catalog)("$theme retains a dense unfamiliar section and portable overrides", ({ data, template }) => {
    const dense = structuredClone(data);
    dense.sections.push({
      node_id: "node_musedense00000001", source_refs: [], semantic_kind: "custom",
      title: { node_id: "node_musedense00000002", source_refs: [], value: "新增的自由章节" },
      entries: [], blocks: [{
        node_id: "node_musedense00000003", source_refs: [], block_type: "paragraph",
        runs: [{ inline_type: "text", text: "长内容末尾标记。".repeat(600), marks: [], href: null,
          style: { color: null, font_size_pt: null, highlight_color: null } }],
      }],
    });
    const style = presentation(template);
    style.portable = { font_scale: 1.15, line_height: 1.7, smart_one_page: false };
    const html = renderResumePrintDocument({ title: "长内容", data: dense, style, layout_plan: layout(dense, template) });
    expect(html).toContain("新增的自由章节");
    expect(html).toContain("长内容末尾标记。".repeat(600));
    expect(html).toContain("--resume-font-size:11.5pt");
    expect(html).toContain("--resume-line-height:1.7");
  });
});

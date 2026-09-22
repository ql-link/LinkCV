/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { atlasThemes } from "../../api/atlasThemes";
import { studioThemes } from "../../api/studioThemes";
import { openThemes } from "../../api/openThemes";
import { originalThemes } from "../../api/originalThemes";
import { careerThemes } from "../../api/careerThemes";
import { featuredThemes } from "../../api/featuredThemes";
import type { CanonicalResumeDocument, CanonicalResumePresentation, LayoutPlan, TemplateDefinition } from "../../api/resumeContract";
import { renderResumePrintDocument } from "../preview/print/resumePrintDocument";

const lateFeaturedThemes = featuredThemes.filter((theme) => theme.startsWith("featured-card-") || ["featured-classic-business", "featured-vitality"].includes(theme));
const baseThemes = [...atlasThemes, ...studioThemes, ...openThemes, ...originalThemes, ...careerThemes, ...featuredThemes.filter((theme) => !lateFeaturedThemes.includes(theme))];
const sql = ["0070", "0071", "0072", "0073", "0074", "0075", "0076", "0078", "0079"].map((revision) => readFileSync(resolve(process.cwd(), `../backend/migrations/sql/${revision}.up.sql`), "utf8")).join("\n");
const payloads = [...sql.matchAll(/CAST\('((?:[^']|'')*)' AS JSON\)/g)]
  .map((match) => JSON.parse(match[1].replace(/''/g, "'")));
const baseSamples = baseThemes.map((theme, index) => ({
  theme,
  data: payloads[index * 2] as CanonicalResumeDocument,
  template: payloads[index * 2 + 1] as TemplateDefinition,
}));
const productData = baseSamples.find(({ theme }) => theme === "featured-product")!.data;
const latePayloads = ["0080", "0081"].flatMap((revision) => [...readFileSync(resolve(process.cwd(), `../backend/migrations/sql/${revision}.up.sql`), "utf8").matchAll(/CAST\('((?:[^']|'')*)' AS JSON\)/g)])
  .map((match) => JSON.parse(match[1].replace(/''/g, "'")) as TemplateDefinition);
const lateSamples = lateFeaturedThemes.map((theme, index) => ({
  theme,
  data: structuredClone(productData),
  template: latePayloads[index],
}));
const samples = [...baseSamples, ...lateSamples];

describe("Visual template catalog renders the shipped samples", () => {
  it.each(samples)("$theme keeps all content and its avatar policy in print HTML", ({ theme, data, template }) => {
    expect(template.template_key).toBe(`${theme}-cn`);
    // Supply a deterministic backend-plan fixture, not a production client-side compiler.
    const nodes = [
      { node_id: data.identity.node_id, semantic_kind: "identity" as const },
      ...data.sections.map(({ node_id, semantic_kind }) => ({ node_id, semantic_kind })),
    ];
    const placements = nodes.map((node) => {
      const slot = template.slots.find((slot) => !slot.universal_fallback && slot.accepts.includes(node.semantic_kind))
        ?? template.slots.find((slot) => slot.universal_fallback)!;
      return { ...node, slot_id: slot.slot_id, region_id: slot.region_id };
    });
    const plan: LayoutPlan = {
      schema_version: "layout-plan.v1",
      content_sha256: `sha256:${"2".repeat(64)}`,
      template_key: template.template_key,
      regions: template.regions.map((region) => ({
        region_id: region.region_id, order: region.order,
        nodes: placements.filter((node) => node.region_id === region.region_id),
      })),
    };
    const style: CanonicalResumePresentation = {
      schema_version: "resume-presentation.v1", portable: {}, template_scoped: {}, template_snapshot: template,
    };
    const html = renderResumePrintDocument({ title: "虚构模板预览", data, style, layout_plan: plan });
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(root.querySelector(`.theme-${theme}`)).not.toBeNull();
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect(root.querySelectorAll("h2")).toHaveLength(data.sections.length);
    expect(root.querySelectorAll("h3")).toHaveLength(data.sections.reduce((sum, s) => sum + s.entries.length, 0));
    expect(root.querySelectorAll(".resume-avatar")).toHaveLength(template.avatar.visibility === "show" ? 1 : 0);
    expect(root.textContent).toContain("zhangsan@example.com");
    for (const section of data.sections) {
      expect(root.textContent).toContain(section.title!.value);
      for (const entry of section.entries) expect(root.textContent).toContain(entry.fields.name!.value);
    }
  });
});

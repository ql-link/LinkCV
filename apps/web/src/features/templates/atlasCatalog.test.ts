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
const seedSamples = baseThemes.map((theme, index) => ({
  theme,
  data: payloads[index * 2] as CanonicalResumeDocument,
  template: payloads[index * 2 + 1] as TemplateDefinition,
}));
const sampleRefreshSql = readFileSync(resolve(process.cwd(), "../backend/migrations/sql/0083.up.sql"), "utf8");
const atlasSampleSources = new Map(
  [...sampleRefreshSql.matchAll(/(?:SELECT|UNION ALL SELECT) '([^']+)'(?: AS target_key)?, '([^']+)'(?: AS source_key)?, '([a-f0-9]{64})'(?: AS target_sha)?, '([a-f0-9]{64})'(?: AS source_sha)?, '([^']+)'(?: AS headline)?/g)]
    .map(([, targetKey, sourceKey, , , headline]) => [targetKey, { sourceTheme: sourceKey.replace(/-cn$/, ""), headline }]),
);
const baseSamples = seedSamples.map((sample) => {
  const source = atlasSampleSources.get(`${sample.theme}-cn`);
  if (!source) return sample;
  const data = structuredClone(seedSamples.find(({ theme }) => theme === source.sourceTheme)!.data);
  data.identity.headline!.value = source.headline;
  return { ...sample, data };
});
const lateSampleSources = new Map(
  [...sampleRefreshSql.matchAll(/JOIN resume_templates AS source ON source\.`key` = '([^']+)'[\s\S]*?'\$\.identity\.headline\.value', '([^']+)'[\s\S]*?WHERE target\.`key` = '([^']+)'/g)]
    .map(([, sourceKey, headline, targetKey]) => [targetKey, { sourceTheme: sourceKey.replace(/-cn$/, ""), headline }]),
);
const latePayloads = ["0080", "0081"].flatMap((revision) => [...readFileSync(resolve(process.cwd(), `../backend/migrations/sql/${revision}.up.sql`), "utf8").matchAll(/CAST\('((?:[^']|'')*)' AS JSON\)/g)])
  .map((match) => JSON.parse(match[1].replace(/''/g, "'")) as TemplateDefinition);
const lateSamples = lateFeaturedThemes.map((theme, index) => ({
  theme,
  data: (() => {
    const source = lateSampleSources.get(`${theme}-cn`)!;
    const data = structuredClone(seedSamples.find(({ theme }) => theme === source.sourceTheme)!.data);
    data.identity.headline!.value = source.headline;
    return data;
  })(),
  template: latePayloads[index],
}));
const samples = [...baseSamples, ...lateSamples];

describe("Visual template catalog renders the shipped samples", () => {
  it("uses non-technical career examples in fifteen Atlas layouts", () => {
    expect(atlasSampleSources.size).toBe(15);
    const headlines = [...atlasSampleSources.values()].map(({ headline }) => headline);
    for (const role of ["教师", "护理", "财务", "人力", "客户经理", "市场", "媒体运营"]) {
      expect(headlines.some((headline) => headline.includes(role))).toBe(true);
    }
  });

  it("refreshes all four reused Featured examples from different career samples", () => {
    expect(lateSampleSources.size).toBe(4);
    expect(new Set(lateSamples.map(({ data }) => data.identity.headline?.value)).size).toBe(4);
  });

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
    for (const region of template.regions.filter((region) => region.region_kind === "sidebar")) {
      expect(placements.some((placement) => placement.region_id === region.region_id)).toBe(true);
    }
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

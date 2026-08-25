import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import type { ResumeDocument, TemplateManifest } from "../../api/resumeContract";
import {
  hasCanonicalTiptapSections,
  resumeDocumentFromEditorDocument,
  resumeDocumentToEditorDocument,
} from "./resumeEditorPersistence";
import {
  composeEditorDocumentForTemplate,
  stripTemplateProjectionFromEditorDocument,
} from "./templateLayout";

const previous: ResumeDocument = {
  basics: {
    name: "张三",
    headline: null,
    email: null,
    phone: null,
    location: null,
    photo: null,
    summary: null,
    links: [],
  },
  sections: {
    work_experiences: [],
    educations: [],
    projects: [],
    skills: [],
    certificates: [],
    awards: [],
    languages: [],
    custom_sections: [
      {
        id: "blk_1111111111111111",
        title: "基本信息",
        items: [{
          id: "item_1111111111111111",
          title: null,
          subtitle: null,
          content: { format: "markdown", content: "# 张三" },
          source_refs: [],
        }],
      },
      {
        id: "blk_2222222222222222",
        title: "工作经历",
        items: [{
          id: "item_2222222222222222",
          title: null,
          subtitle: null,
          content: { format: "markdown", content: "负责示例项目" },
          source_refs: [],
        }],
      },
      {
        id: "blk_3333333333333333",
        title: "专业技能",
        items: [{
          id: "item_3333333333333333",
          title: null,
          subtitle: null,
          content: { format: "markdown", content: "TypeScript" },
          source_refs: [],
        }],
      },
    ],
  },
  semantic_sections: [
    {
      id: "sem_1111111111111111",
      semantic_kind: "basics",
      display_title: "基本信息",
      semantic_source: "system",
      semantic_confidence: null,
      content_key: "custom_sections",
      custom_section_id: "blk_1111111111111111",
    },
    {
      id: "sem_2222222222222222",
      semantic_kind: "work",
      display_title: "工作经历",
      semantic_source: "user",
      semantic_confidence: null,
      content_key: "custom_sections",
      custom_section_id: "blk_2222222222222222",
    },
    {
      id: "sem_3333333333333333",
      semantic_kind: "skills",
      display_title: "专业技能",
      semantic_source: "user",
      semantic_confidence: null,
      content_key: "custom_sections",
      custom_section_id: "blk_3333333333333333",
    },
  ],
};

const flowManifest: TemplateManifest = {
  renderer_key: "flow",
  regions: [{ id: "main", kind: "main", order: 0 }],
  slots: [{
    id: "main-content",
    region_id: "main",
    accepts: ["basics", "profile", "work", "education", "project", "skills", "activity", "interests", "certificates", "awards", "languages", "custom"],
    required: false,
    fallback: true,
    order: 0,
  }],
  avatar: { visibility: "hide", fallback_asset: "none", size: 96 },
};

const columnsManifest: TemplateManifest = {
  renderer_key: "columns",
  regions: [
    { id: "sidebar", kind: "sidebar", order: 0 },
    { id: "main", kind: "main", order: 1 },
  ],
  slots: [
    {
      id: "sidebar-content",
      region_id: "sidebar",
      accepts: ["profile", "skills", "interests", "languages", "avatar"],
      required: false,
      fallback: false,
      order: 0,
    },
    {
      id: "main-content",
      region_id: "main",
      accepts: ["basics", "profile", "work", "education", "project", "skills", "activity", "interests", "certificates", "awards", "languages", "custom"],
      required: false,
      fallback: true,
      order: 1,
    },
  ],
  avatar: { visibility: "show", fallback_asset: "system-default", size: 108 },
};

const flowAvatarManifest: TemplateManifest = {
  ...flowManifest,
  avatar: { visibility: "show", fallback_asset: "system-default", size: 96 },
};

const hiddenColumnsManifest: TemplateManifest = {
  ...columnsManifest,
  avatar: { visibility: "hide", fallback_asset: "none", size: 96 },
};

const officialManifests: Array<{ key: string; manifest: TemplateManifest }> = [
  "classic-cn",
  "compact-tech-cn",
  "classic-technical-cn",
].map((key) => ({ key, manifest: flowManifest })).concat([
  { key: "modern-two-column-cn", manifest: hiddenColumnsManifest },
  { key: "administrative-sidebar-cn", manifest: columnsManifest },
  { key: "campus-professional-cn", manifest: flowAvatarManifest },
  { key: "civic-service-cn", manifest: flowAvatarManifest },
  { key: "creative-orange-cn", manifest: flowAvatarManifest },
]);

function text(value: string, marks?: JSONContent["marks"]): JSONContent {
  return { type: "text", text: value, ...(marks ? { marks } : {}) };
}

const projected: JSONContent = {
  type: "doc",
  content: [{
    type: "resumeColumns",
    content: [
      {
        type: "resumeColumn",
        attrs: { variant: "sidebar" },
        content: [
          { type: "avatarImage", attrs: { src: "/api/resumes/1/assets/avatar.png", size: 112, alt: "头像", systemFallback: false } },
          {
            type: "heading",
            attrs: { level: 2, textAlign: null },
            content: [
              { type: "resumeBlockAnchor", attrs: { blockId: "blk_3333333333333333", semanticKind: "skills" } },
              text("专业技能"),
            ],
          },
          {
            type: "paragraph",
            attrs: { textAlign: null },
            content: [
              { type: "resumeBlockAnchor", attrs: { blockId: "blk_aaaaaaaaaaaaaaaa", semanticKind: null } },
              text("TypeScript", [
                { type: "underline" },
                { type: "textStyle", attrs: { color: "#3478f6", fontSize: "11.5pt" } },
                { type: "highlight", attrs: { color: "#fff3c4" } },
              ]),
            ],
          },
        ],
      },
      {
        type: "resumeColumn",
        attrs: { variant: "main" },
        content: [
          {
            type: "heading",
            attrs: { level: 1, textAlign: "center" },
            content: [
              { type: "resumeBlockAnchor", attrs: { blockId: "blk_bbbbbbbbbbbbbbbb", semanticKind: null } },
              text("张三"),
            ],
          },
          {
            type: "heading",
            attrs: { level: 2, textAlign: null },
            content: [
              { type: "resumeBlockAnchor", attrs: { blockId: "blk_2222222222222222", semanticKind: "work" } },
              text("工作经历"),
            ],
          },
          {
            type: "paragraph",
            attrs: { textAlign: null },
            content: [
              { type: "resumeBlockAnchor", attrs: { blockId: "blk_cccccccccccccccc", semanticKind: null } },
              text("负责示例项目", [{ type: "bold" }]),
            ],
          },
        ],
      },
    ],
  }],
};

describe("resume editor persistence", () => {
  it("persists a projection-free Tiptap tree without losing marks, ids or the user avatar", () => {
    const data = resumeDocumentFromEditorDocument(projected, previous);
    const restored = resumeDocumentToEditorDocument(data);

    expect(hasCanonicalTiptapSections(data)).toBe(true);
    expect(data.basics.photo).toBe("/api/resumes/1/assets/avatar.png");
    expect(data.semantic_sections.map((section) => section.semantic_kind)).toEqual([
      "basics",
      "work",
      "skills",
    ]);
    expect(restored).toEqual(stripTemplateProjectionFromEditorDocument(projected, previous));
    expect(JSON.stringify(restored)).toContain('"type":"underline"');
    expect(JSON.stringify(restored)).toContain('"color":"#3478f6"');
    expect(JSON.stringify(restored)).toContain('"color":"#fff3c4"');
    expect(JSON.stringify(restored)).not.toContain("resumeColumns");
    expect(JSON.stringify(restored)).not.toContain("avatarImage");
  });

  it("keeps canonical content identical across columns, flow and columns again", () => {
    const data = resumeDocumentFromEditorDocument(projected, previous);
    const canonical = resumeDocumentToEditorDocument(data)!;
    const flow = composeEditorDocumentForTemplate(canonical, flowManifest, data.basics.photo, data);
    const columns = composeEditorDocumentForTemplate(flow, columnsManifest, data.basics.photo, data);

    expect(stripTemplateProjectionFromEditorDocument(flow, data)).toEqual(canonical);
    expect(stripTemplateProjectionFromEditorDocument(columns, data)).toEqual(canonical);
  });

  it("preserves every legacy item source reference without adding editor nodes", () => {
    const withMultipleSources: ResumeDocument = {
      ...previous,
      sections: {
        ...previous.sections,
        custom_sections: previous.sections.custom_sections.map((section) => (
          section.id !== "blk_2222222222222222"
            ? section
            : {
              ...section,
              items: [
                {
                  ...section.items[0],
                  source_refs: [{
                    field: "work.first",
                    source: "extracted_markdown",
                    start_line: 1,
                    end_line: 1,
                    quote: "负责示例项目",
                  }],
                },
                {
                  id: "item_legacy_source_2",
                  title: null,
                  subtitle: null,
                  content: { format: "markdown", content: "" },
                  source_refs: [{
                    field: "work.second",
                    source: "extracted_markdown",
                    start_line: 2,
                    end_line: 2,
                    quote: "补充来源",
                  }],
                },
              ],
            }
        )),
      },
    };

    const data = resumeDocumentFromEditorDocument(projected, withMultipleSources);
    const work = data.sections.custom_sections.find(
      (section) => section.id === "blk_2222222222222222",
    )!;

    expect(work.items.map((item) => item.id)).toEqual([
      "item_2222222222222222",
      "item_legacy_source_2",
    ]);
    expect(work.items.flatMap((item) => item.source_refs.map((ref) => ref.field))).toEqual([
      "work.first",
      "work.second",
    ]);
    expect(resumeDocumentToEditorDocument(data)).toEqual(
      stripTemplateProjectionFromEditorDocument(projected, withMultipleSources),
    );
  });

  it("keeps canonical content identical across every official template pair", () => {
    const data = resumeDocumentFromEditorDocument(projected, previous);
    const canonical = resumeDocumentToEditorDocument(data)!;
    let pairs = 0;

    for (const source of officialManifests) {
      const sourceProjection = composeEditorDocumentForTemplate(
        canonical,
        source.manifest,
        data.basics.photo,
        data,
      );
      for (const target of officialManifests) {
        const targetProjection = composeEditorDocumentForTemplate(
          sourceProjection,
          target.manifest,
          data.basics.photo,
          data,
        );
        expect(
          stripTemplateProjectionFromEditorDocument(targetProjection, data),
          `${source.key} -> ${target.key}`,
        ).toEqual(canonical);
        expect(JSON.stringify(targetProjection).match(/负责示例项目/gu)).toHaveLength(1);
        expect(JSON.stringify(targetProjection).match(/TypeScript/gu)).toHaveLength(1);
        expect(JSON.stringify(targetProjection).match(/blk_2222222222222222/gu)).toHaveLength(1);
        expect(JSON.stringify(targetProjection).match(/blk_3333333333333333/gu)).toHaveLength(1);
        pairs += 1;
      }
    }

    expect(pairs).toBe(64);
  });
});

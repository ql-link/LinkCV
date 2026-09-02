import { describe, expect, it } from "vitest";
import {
  defaultSemanticDocument,
  defaultSemanticStyle,
  editorDocumentToMarkdown,
  resumeDocumentFromMarkdown,
  resumeDocumentToMarkdown,
  type CanonicalResumeDocument,
  type LayoutPlan,
  type TemplateDefinition,
} from "../../api/resumeContract";
import {
  composeEditorDocumentForLayoutPlan,
  composeEditorDocumentForTemplate,
  composeResumeMarkdownForTemplate,
  stripTemplateProjectionFromEditorDocument,
} from "./templateLayout";
import { canonicalResumeDocumentToEditorDocument } from "./resumeEditorPersistence";

const flowManifest = defaultSemanticStyle.manifest;
const columnsManifest = {
  ...flowManifest,
  renderer_key: "columns" as const,
  regions: [
    { id: "sidebar", kind: "sidebar" as const, order: 0 },
    { id: "main", kind: "main" as const, order: 1 },
  ],
  slots: [
    {
      id: "sidebar-basics",
      region_id: "sidebar",
      accepts: ["basics" as const, "avatar" as const],
      required: false,
      fallback: false,
      order: 0,
    },
    {
      id: "main-content",
      region_id: "main",
      accepts: ["work" as const, "custom" as const],
      required: false,
      fallback: true,
      order: 1,
    },
  ],
  avatar: { visibility: "show" as const, fallback_asset: "system-default" as const, size: 96 },
};

const document = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "张三" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "工作历程" }] },
    { type: "paragraph", content: [{ type: "text", text: "负责虚构项目" }] },
  ],
};

const resumeDocument = {
  ...defaultSemanticDocument,
  semantic_sections: [
    ...defaultSemanticDocument.semantic_sections,
    {
      id: "semantic_work",
      semantic_kind: "work" as const,
      display_title: "工作历程",
      semantic_source: "user" as const,
      semantic_confidence: null,
      content_key: "work_experiences" as const,
      custom_section_id: null,
    },
  ],
};

describe("template manifest composer", () => {
  it("removes persisted legacy layout before projecting the current manifest", () => {
    const canonical = {
      ...defaultSemanticDocument,
      sections: {
        ...defaultSemanticDocument.sections,
        custom_sections: [
          {
            id: "blk_1111111111111111",
            title: "基本信息",
            items: [{
              id: "item_1111111111111111",
              title: null,
              subtitle: null,
              content: {
                format: "markdown" as const,
                content: ":::: sidebar\n侧栏信息\n::::\n\n:::: main\n# 张三",
              },
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
              content: { format: "markdown" as const, content: "虚构正文\n::::" },
              source_refs: [],
            }],
          },
        ],
      },
      semantic_sections: [
        {
          id: "semantic_blk_1111111111111111",
          semantic_kind: "basics" as const,
          display_title: "基本信息",
          semantic_source: "system" as const,
          semantic_confidence: null,
          content_key: "custom_sections" as const,
          custom_section_id: "blk_1111111111111111",
        },
        {
          id: "semantic_blk_2222222222222222",
          semantic_kind: "work" as const,
          display_title: "工作经历",
          semantic_source: "system" as const,
          semantic_confidence: null,
          content_key: "custom_sections" as const,
          custom_section_id: "blk_2222222222222222",
        },
      ],
    };

    const composed = composeResumeMarkdownForTemplate(canonical, columnsManifest);

    expect(composed).not.toBe(resumeDocumentToMarkdown(canonical));
    expect(composed.match(/:::: sidebar/gu)).toHaveLength(1);
    expect(composed.match(/:::: main/gu)).toHaveLength(1);
    expect(composed.match(/# 张三/gu)).toHaveLength(1);
    expect(composed).toContain("侧栏信息");
    expect(composed).toContain("虚构正文");
    expect(composed).not.toContain("## 基本信息");
  });

  it("uses the manifest to compose columns and preserves every content node once", () => {
    const columns = composeEditorDocumentForTemplate(document, columnsManifest, null, resumeDocument);
    const flow = composeEditorDocumentForTemplate(columns, flowManifest, null, resumeDocument);
    const markdown = editorDocumentToMarkdown(flow);

    expect(columns.content?.[0]?.type).toBe("resumeColumns");
    expect(markdown.match(/张三/g)).toHaveLength(1);
    expect(markdown.match(/工作历程/g)).toHaveLength(1);
    expect(markdown.match(/负责虚构项目/g)).toHaveLength(1);
    expect(markdown.indexOf("张三")).toBeLessThan(markdown.indexOf("工作历程"));
  });

  it("restores a basics block placed after the main column to canonical order", () => {
    const columns = composeEditorDocumentForTemplate(document, columnsManifest, null, resumeDocument);
    const restored = stripTemplateProjectionFromEditorDocument(columns, resumeDocument);
    const flow = composeEditorDocumentForTemplate(columns, flowManifest, null, resumeDocument);

    expect(restored).toEqual(document);
    expect(editorDocumentToMarkdown(flow)).toBe(editorDocumentToMarkdown(document));
  });

  it("renders a system fallback avatar without persisting it as user content", () => {
    const composed = composeEditorDocumentForTemplate(document, columnsManifest, null, resumeDocument);
    const serialized = JSON.stringify(composed);

    expect(serialized).toContain('"systemFallback":true');
    expect(serialized).toContain("/templates/avatar-cat.jpg");
    expect(editorDocumentToMarkdown(composed)).not.toContain("avatar-cat.jpg");
  });

  it("restores the user avatar after passing through a hidden-avatar template", () => {
    const hidden = composeEditorDocumentForTemplate(document, flowManifest, "/api/resumes/1/assets/avatar.jpg", resumeDocument);
    const shown = composeEditorDocumentForTemplate(hidden, columnsManifest, "/api/resumes/1/assets/avatar.jpg", resumeDocument);

    expect(JSON.stringify(hidden)).not.toContain("avatar.jpg");
    expect(JSON.stringify(shown)).toContain("avatar.jpg");
  });

  it("keeps a required empty slot out of persisted editor content", () => {
    const manifest = {
      ...flowManifest,
      slots: [
        {
          id: "certificates",
          region_id: "main",
          accepts: ["certificates" as const],
          required: true,
          fallback: false,
          order: 0,
        },
        {
          id: "fallback",
          region_id: "main",
          accepts: ["basics" as const, "custom" as const],
          required: false,
          fallback: true,
          order: 1,
        },
      ],
    };

    const composed = composeEditorDocumentForTemplate(document, manifest, null, resumeDocument);

    expect(editorDocumentToMarkdown(composed)).toBe(editorDocumentToMarkdown(document));
    expect(JSON.stringify(composed)).not.toContain("示例证书");
    expect(JSON.stringify(composed)).not.toContain("证书");
  });

  it("preserves every stable content id exactly once across every manifest pair", () => {
    const stableDocument = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [
            { type: "resumeBlockAnchor", attrs: { blockId: "blk_1111111111111111" } },
            { type: "text", text: "张三" },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [
            { type: "resumeBlockAnchor", attrs: { blockId: "blk_2222222222222222", semanticKind: "work" } },
            { type: "text", text: "经历" },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "resumeBlockAnchor", attrs: { blockId: "blk_3333333333333333" } },
            { type: "text", text: "相同标题也依赖 ID" },
            { type: "inlineImage", attrs: { src: "/api/resumes/1/assets/logo.png", width: 48, height: 24, aspectRatio: 2, alt: "Logo" } },
          ],
        },
      ],
    };
    const data = resumeDocumentFromMarkdown(editorDocumentToMarkdown(stableDocument), defaultSemanticDocument);
    const avatarFlow = {
      ...flowManifest,
      avatar: { visibility: "show" as const, fallback_asset: "system-default" as const, size: 72 },
    };
    const manifests = [flowManifest, columnsManifest, avatarFlow];
    const ids = ["blk_1111111111111111", "blk_2222222222222222", "blk_3333333333333333"];

    for (const sourceManifest of manifests) {
      const source = composeEditorDocumentForTemplate(stableDocument, sourceManifest, null, data);
      for (const targetManifest of manifests) {
        const target = composeEditorDocumentForTemplate(source, targetManifest, null, data);
        const serialized = JSON.stringify(target);
        for (const id of ids) {
          expect(serialized.match(new RegExp(id, "gu")), `${sourceManifest.renderer_key} -> ${targetManifest.renderer_key}: ${id}`).toHaveLength(1);
        }
        expect(serialized.match(/logo\.png/gu)).toHaveLength(1);
      }
    }
  });

  it("restores one global semantic order instead of concatenating main before sidebar", () => {
    const orderedDocument = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "张三" }] },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [
            { type: "resumeBlockAnchor", attrs: { blockId: "blk_3333333333333333", semanticKind: "skills" } },
            { type: "text", text: "专业技能" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "TypeScript" }] },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [
            { type: "resumeBlockAnchor", attrs: { blockId: "blk_2222222222222222", semanticKind: "work" } },
            { type: "text", text: "工作经历" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "虚构公司" }] },
      ],
    };
    const data = resumeDocumentFromMarkdown(
      editorDocumentToMarkdown(orderedDocument),
      defaultSemanticDocument,
    );
    const projected = composeEditorDocumentForTemplate(
      orderedDocument,
      columnsManifest,
      null,
      data,
    );

    expect(stripTemplateProjectionFromEditorDocument(projected, data)).toEqual(orderedDocument);
  });

  it("does not persist the blank paragraph used only to keep an empty column editable", () => {
    const noAvatarColumns = {
      ...columnsManifest,
      avatar: { visibility: "hide" as const, fallback_asset: "none" as const, size: 96 },
    };
    const projected = composeEditorDocumentForTemplate(
      document,
      noAvatarColumns,
      null,
      resumeDocument,
    );

    expect(stripTemplateProjectionFromEditorDocument(projected, resumeDocument)).toEqual(document);
  });
});

const canonicalLayoutDocument: CanonicalResumeDocument = {
  schema_version: "canonical-resume.v1",
  document_id: "node_aaaaaaaaaaaaaaaa",
  identity: {
    node_id: "node_bbbbbbbbbbbbbbbb",
    name: { node_id: "node_cccccccccccccccc", value: "张三", source_refs: [] },
    headline: null,
    contacts: [],
    avatar: null,
  },
  sections: [{
    node_id: "node_dddddddddddddddd",
    semantic_kind: "work",
    title: { node_id: "node_eeeeeeeeeeeeeeee", value: "工作", source_refs: [] },
    entries: [],
    blocks: [{
      node_id: "node_ffffffffffffffff",
      block_type: "paragraph",
      runs: [{
        inline_type: "text",
        text: "正文",
        marks: [],
        href: null,
        style: { color: null, font_size_pt: null, highlight_color: null },
      }],
      source_refs: [],
    }],
    source_refs: [],
  }],
  source_dispositions: [],
};

const canonicalTemplate: TemplateDefinition = {
  schema_version: "template-definition.v1",
  template_key: "canonical-columns",
  semantic_labels: {
    profile: "个人简介",
    work: "工作",
    education: "教育",
    project: "项目",
    skills: "技能",
    activity: "活动",
    interests: "兴趣",
    certificates: "证书",
    awards: "奖项",
    languages: "语言",
  },
  regions: [
    { region_id: "sidebar", region_kind: "sidebar", order: 0 },
    { region_id: "main", region_kind: "main", order: 1 },
  ],
  // accepts deliberately does not describe the mapping below. LayoutPlan is
  // the only source of placement for the canonical path.
  slots: [
    { slot_id: "sidebar-only", region_id: "sidebar", accepts: ["work"], universal_fallback: false, order: 0 },
    { slot_id: "main-fallback", region_id: "main", accepts: ["identity", "profile", "work", "education", "project", "skills", "activity", "interests", "certificates", "awards", "languages", "custom"], universal_fallback: true, order: 0 },
  ],
  tokens: { font_family: "Source Han Serif SC", font_size_pt: 10, line_height: 1.5, accent_color: "#2F4858", page_margin_mm: 14 },
  avatar: { visibility: "show", fallback_asset: "system-default", size_px: 96, region_id: "sidebar" },
};

const canonicalLayoutPlan: LayoutPlan = {
  schema_version: "layout-plan.v1",
  content_sha256: "2222222222222222222222222222222222222222222222222222222222222222",
  template_key: "canonical-columns",
  regions: [
    { region_id: "sidebar", order: 0, nodes: [{ node_id: "node_bbbbbbbbbbbbbbbb", semantic_kind: "identity", slot_id: "sidebar-only" }] },
    { region_id: "main", order: 1, nodes: [{ node_id: "node_dddddddddddddddd", semantic_kind: "work", slot_id: "main-fallback" }] },
  ],
};

describe("canonical LayoutPlan consumer", () => {
  it("places canonical roots exactly as the backend plan says and ignores slot accepts", () => {
    const source = canonicalLayoutDocumentToEditor();
    const projected = composeEditorDocumentForLayoutPlan(source, canonicalLayoutDocument, canonicalLayoutPlan, canonicalTemplate);
    const columns = projected.content?.find((node) => node.type === "resumeColumns");
    expect(columns?.content?.[0].content?.map((node) => node.type)).toContain("heading");
    expect(columns?.content?.[1].content?.map((node) => node.type)).toContain("heading");
    expect(JSON.stringify(columns?.content?.[0])).toContain("张三");
    expect(JSON.stringify(columns?.content?.[1])).toContain("正文");
  });

  it("accepts a layout-owned identity root when the template example has no visible identity content", () => {
    const emptyIdentityDocument: CanonicalResumeDocument = {
      ...canonicalLayoutDocument,
      identity: {
        ...canonicalLayoutDocument.identity,
        name: null,
        headline: null,
        contacts: [],
        avatar: null,
      },
    };
    const source = canonicalLayoutDocumentToEditor();
    source.content = source.content?.filter((node) => Number(node.attrs?.level) !== 1);

    expect(() => composeEditorDocumentForLayoutPlan(
      source,
      emptyIdentityDocument,
      canonicalLayoutPlan,
      canonicalTemplate,
    )).not.toThrow();
  });

  it("renders canonical system avatar fallback without persisting it or raw row markers", () => {
    const source = canonicalResumeDocumentToEditorDocument(canonicalLayoutDocument);
    const projected = composeEditorDocumentForLayoutPlan(
      source,
      canonicalLayoutDocument,
      canonicalLayoutPlan,
      canonicalTemplate,
    );

    expect(JSON.stringify(projected)).toContain("/templates/avatar-cat.jpg");
    expect(JSON.stringify(projected)).toContain('"systemFallback":true');
    expect(editorDocumentToMarkdown(projected)).not.toContain("avatar-cat.jpg");
    expect(editorDocumentToMarkdown(source)).not.toContain(":::");
  });

  it("shows user avatar at the template size and preserves it when the template hides avatars", () => {
    const userAvatarDocument: CanonicalResumeDocument = {
      ...canonicalLayoutDocument,
      identity: {
        ...canonicalLayoutDocument.identity,
        avatar: {
          node_id: "node_avatar1111111111",
          source_refs: ["src_avatar1111111111"],
          media_kind: "avatar",
          src: "/api/resumes/1/assets/avatar.png",
          alt: "头像",
          width: 80,
          width_unit: "px",
          height_px: 80,
          align: "center",
          system_fallback: false,
        },
      },
    };
    const source = canonicalResumeDocumentToEditorDocument(userAvatarDocument);
    const shown = composeEditorDocumentForLayoutPlan(
      source,
      userAvatarDocument,
      canonicalLayoutPlan,
      canonicalTemplate,
    );
    const hiddenTemplate: TemplateDefinition = {
      ...canonicalTemplate,
      avatar: { visibility: "hide", fallback_asset: "none", size_px: 96, region_id: "sidebar" },
    };
    const hidden = composeEditorDocumentForLayoutPlan(
      source,
      userAvatarDocument,
      canonicalLayoutPlan,
      hiddenTemplate,
    );

    expect(JSON.stringify(shown)).toContain("/api/resumes/1/assets/avatar.png");
    expect(JSON.stringify(shown)).toContain('"size":96');
    expect(JSON.stringify(shown)).toContain('"systemFallback":false');
    expect(JSON.stringify(hidden)).not.toContain("/api/resumes/1/assets/avatar.png");
    expect(userAvatarDocument.identity.avatar?.src).toBe("/api/resumes/1/assets/avatar.png");
  });
});

function canonicalLayoutDocumentToEditor() {
  return {
    type: "doc" as const,
    content: [
      { type: "heading" as const, attrs: { level: 1 }, content: [{ type: "resumeBlockAnchor" as const, attrs: { blockId: "node_bbbbbbbbbbbbbbbb" } }, { type: "text" as const, text: "张三" }] },
      { type: "heading" as const, attrs: { level: 2 }, content: [{ type: "resumeBlockAnchor" as const, attrs: { blockId: "node_dddddddddddddddd", semanticKind: "work" } }, { type: "text" as const, text: "工作" }] },
      { type: "paragraph" as const, content: [{ type: "resumeBlockAnchor" as const, attrs: { blockId: "node_ffffffffffffffff" } }, { type: "text" as const, text: "正文" }] },
    ],
  };
}

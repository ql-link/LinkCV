import { describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import type {
  CanonicalResumeDocument,
  CanonicalTextRun,
  ResumeDocument,
  TemplateManifest,
} from "../../api/resumeContract";
import { resumeEditorExtensions } from "./editorExtensions";
import {
  canonicalResumeDocumentFromEditorDocument,
  canonicalResumeDocumentToEditorDocument,
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
  it("normalizes the no-op ordered-list type emitted by Tiptap before persistence", () => {
    const editor = new Editor({
      extensions: resumeEditorExtensions,
      content: "<h1>张三</h1><h2>工作经历</h2><ol><li><p>第一项</p></li></ol>",
    });
    try {
      const editorDocument = editor.getJSON();
      const editorOrderedList = editorDocument.content?.find((node) => node.type === "orderedList");
      expect(editorOrderedList?.attrs).toEqual({ start: 1, type: null });

      const data = resumeDocumentFromEditorDocument(editorDocument, previous);
      const persistedWork = data.sections.custom_sections.find(
        (section) => section.id === "blk_2222222222222222",
      );
      const persistedOrderedList = persistedWork?.items[0]?.content.format === "tiptap-json"
        ? persistedWork.items[0].content.content.content?.find(
          (node) => node.type === "orderedList",
        )
        : undefined;

      expect(persistedOrderedList?.attrs).toEqual({ start: 1 });
      expect(editorOrderedList?.attrs).toEqual({ start: 1, type: null });
    } finally {
      editor.destroy();
    }
  });

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

const canonicalFixture: CanonicalResumeDocument = {
  schema_version: "canonical-resume.v1",
  document_id: "node_aaaaaaaaaaaaaaaa",
  identity: {
    node_id: "node_bbbbbbbbbbbbbbbb",
    name: {
      node_id: "node_cccccccccccccccc",
      value: "张三",
      source_refs: [],
    },
    headline: {
      node_id: "node_dddddddddddddddd",
      value: "后端工程师",
      source_refs: [],
    },
    contacts: [],
    avatar: null,
  },
  sections: [{
    node_id: "node_eeeeeeeeeeeeeeee",
    semantic_kind: "work",
    title: {
      node_id: "node_ffffffffffffffff",
      value: "工作经历",
      source_refs: [],
    },
    entries: [],
    blocks: [{
      node_id: "node_1111111111111111",
      block_type: "paragraph",
      runs: [{
        inline_type: "text",
        text: "负责服务治理",
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

function canonicalTextRun(text: string): CanonicalTextRun {
  return {
    inline_type: "text",
    text,
    marks: [],
    href: null,
    style: { color: null, font_size_pt: null, highlight_color: null },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const canonicalEditingFixture: CanonicalResumeDocument = {
  schema_version: "canonical-resume.v1",
  document_id: "node_aaaaaaaaaaaaaaaa",
  identity: {
    node_id: "node_bbbbbbbbbbbbbbbb",
    name: { node_id: "node_cccccccccccccccc", value: "张三", source_refs: ["src_nameaaaaaaaaaaaa"] },
    headline: { node_id: "node_dddddddddddddddd", value: "后端工程师", source_refs: ["src_headlineaaaaaaa"] },
    contacts: [
      {
        node_id: "node_eeeeeeeeeeeeeeee",
        source_refs: ["src_emailaaaaaaaaaaa"],
        contact_kind: "email",
        value: "zhangsan@example.com",
        label: "邮箱",
      },
      {
        node_id: "node_ffffffffffffffff",
        source_refs: ["src_phoneaaaaaaaaaaa"],
        contact_kind: "phone",
        value: "+86 138 0000 0000",
        label: "电话",
      },
    ],
    avatar: {
      node_id: "node_gggggggggggggggg",
      source_refs: ["src_avataraaaaaaaaa"],
      media_kind: "avatar",
      src: "/api/resumes/1/assets/avatar.png",
      alt: "头像",
      width: 96,
      width_unit: "px",
      height_px: null,
      align: null,
      system_fallback: false,
    },
  },
  sections: [
    {
      node_id: "node_hhhhhhhhhhhhhhhh",
      source_refs: ["src_workaaaaaaaaaaa"],
      semantic_kind: "work",
      title: { node_id: "node_iiiiiiiiiiiiiiii", value: "工作经历", source_refs: ["src_worktitleaaaaa"] },
      entries: [
        {
          node_id: "node_jjjjjjjjjjjjjjjj",
          source_refs: ["src_entryoneaaaaaaa"],
          fields: {
            name: { node_id: "node_kkkkkkkkkkkkkkkk", value: "示例公司", source_refs: ["src_companyaaaaaaa"] },
            organization: { node_id: "node_llllllllllllllll", value: "平台组", source_refs: ["src_orgaaaaaaaaaaa"] },
            role: { node_id: "node_mmmmmmmmmmmmmmmm", value: "后端工程师", source_refs: ["src_roleaaaaaaaaaa"] },
          },
          blocks: [
            {
              node_id: "node_nnnnnnnnnnnnnnnn",
              source_refs: ["src_retainedblockaaaa"],
              block_type: "paragraph",
              runs: [canonicalTextRun("负责平台治理")],
            },
            {
              node_id: "node_oooooooooooooooo",
              block_type: "bullet_list",
              start: null,
              items: [
                { node_id: "node_pppppppppppppppp", source_refs: ["src_listoneaaaaaaa"], runs: [canonicalTextRun("服务治理")] },
                { node_id: "node_qqqqqqqqqqqqqqqq", source_refs: ["src_listtwoaaaaaaa"], runs: [canonicalTextRun("稳定性建设")] },
              ],
            },
            {
              node_id: "node_rrrrrrrrrrrrrrrr",
              source_refs: ["src_rowaaaaaaaaaaa"],
              block_type: "row",
              row_kind: "pair",
              left_width_percent: 60,
              cells: [
                {
                  node_id: "node_ssssssssssssssss",
                  source_refs: [],
                  blocks: [{
                    node_id: "node_tttttttttttttttt",
                    source_refs: [],
                    block_type: "paragraph",
                    runs: [canonicalTextRun("左栏")],
                  }],
                },
                {
                  node_id: "node_uuuuuuuuuuuuuuuu",
                  source_refs: [],
                  blocks: [{
                    node_id: "node_vvvvvvvvvvvvvvvv",
                    source_refs: [],
                    block_type: "paragraph",
                    runs: [canonicalTextRun("右栏")],
                  }],
                },
              ],
            },
          ],
        },
        {
          node_id: "node_wwwwwwwwwwwwwwww",
          source_refs: [],
          fields: {
            name: { node_id: "node_xxxxxxxxxxxxxxxx", value: "另一家公司", source_refs: [] },
          },
          blocks: [{
            node_id: "node_yyyyyyyyyyyyyyyy",
            source_refs: [],
            block_type: "paragraph",
            runs: [canonicalTextRun("第二段经历")],
          }],
        },
      ],
      blocks: [{
        node_id: "node_zzzzzzzzzzzzzzzz",
        source_refs: ["src_sectionblockaaaa"],
        block_type: "paragraph",
        runs: [canonicalTextRun("工作补充")],
      }],
    },
    {
      node_id: "node_1234567890abcdef",
      source_refs: [],
      semantic_kind: "skills",
      title: { node_id: "node_234567890abcdef1", value: "技能", source_refs: [] },
      entries: [],
      blocks: [{
        node_id: "node_34567890abcdef12",
        source_refs: [],
        block_type: "paragraph",
        runs: [canonicalTextRun("TypeScript")],
      }],
    },
    {
      node_id: "node_4567890abcdef123",
      source_refs: [],
      semantic_kind: "education",
      title: { node_id: "node_567890abcdef1234", value: "教育经历", source_refs: [] },
      entries: [],
      blocks: [{
        node_id: "node_67890abcdef12345",
        source_refs: ["src_removedblockaaaa"],
        block_type: "paragraph",
        runs: [canonicalTextRun("待删除来源目标")],
      }],
    },
  ],
  source_dispositions: [
    {
      source_id: "src_retainedblockaaaa",
      outcome: "mapped",
      target_node_ids: ["node_nnnnnnnnnnnnnnnn"],
      reason_code: null,
    },
    {
      source_id: "src_removedblockaaaa",
      outcome: "mapped",
      target_node_ids: ["node_67890abcdef12345"],
      reason_code: null,
    },
    {
      source_id: "src_avataraaaaaaaaa",
      outcome: "mapped",
      target_node_ids: ["node_gggggggggggggggg"],
      reason_code: null,
    },
  ],
};

describe("canonical resume editing projection", () => {
  it("keeps canonical ids while using TipTap only as an editing projection", () => {
    const editor = canonicalResumeDocumentToEditorDocument(canonicalFixture);
    const serialized = JSON.stringify(editor);
    expect(serialized).toContain("node_bbbbbbbbbbbbbbbb");
    expect(serialized).toContain("node_eeeeeeeeeeeeeeee");
    expect(serialized).toContain("node_1111111111111111");
    expect(serialized).not.toContain("semantic_sections");

    const edited = JSON.parse(serialized) as JSONContent;
    const paragraph = edited.content?.find((node) => node.type === "paragraph" && node.content?.some((child) => child.type === "resumeBlockAnchor" && child.attrs?.blockId === "node_1111111111111111"));
    const text = paragraph?.content?.find((child) => child.type === "text");
    if (text) text.text = "负责平台治理";
    const persisted = canonicalResumeDocumentFromEditorDocument(edited, canonicalFixture);
    expect(persisted.sections[0].blocks[0]).toMatchObject({ node_id: "node_1111111111111111" });
    expect(persisted.sections[0].blocks[0].block_type).toBe("paragraph");
    expect((persisted.sections[0].blocks[0] as { runs: Array<{ text: string }> }).runs[0].text).toBe("负责平台治理");
  });

  it("round-trips canonical inline and section-title icons", () => {
    const expectedRuns = [
      canonicalTextRun("前 "),
      { inline_type: "icon" as const, name: "Mail" as const },
      canonicalTextRun(" 后"),
    ];
    const iconDocument: CanonicalResumeDocument = {
      ...canonicalFixture,
      sections: [{
        ...canonicalFixture.sections[0],
        title_icon: { inline_type: "icon", name: "Briefcase" },
        blocks: [{
          node_id: "node_1111111111111111",
          source_refs: [],
          block_type: "paragraph" as const,
          runs: expectedRuns,
        }],
      }],
    };

    const editor = canonicalResumeDocumentToEditorDocument(iconDocument);
    const heading = editor.content?.find((node) => node.type === "heading" && node.attrs?.level === 2);
    expect(heading?.content).toEqual(expect.arrayContaining([
      { type: "inlineIcon", attrs: { name: "Briefcase" } },
      { type: "text", text: "工作经历" },
    ]));
    const paragraph = editor.content?.find((node) => (
      node.type === "paragraph" && node.content?.some((child) => child.type === "inlineIcon")
    ));
    expect(paragraph?.content).toContainEqual({ type: "inlineIcon", attrs: { name: "Mail" } });

    const restored = canonicalResumeDocumentFromEditorDocument(editor, iconDocument);
    expect(restored.sections[0].title_icon).toEqual({ inline_type: "icon", name: "Briefcase" });
    const restoredBlock = restored.sections[0].blocks[0];
    expect(restoredBlock.block_type).toBe("paragraph");
    if (restoredBlock.block_type === "paragraph") {
      expect(restoredBlock.runs).toEqual(expectedRuns);
    }
  });

  it.each([
    ["pair", 2, 64],
    ["meta", 4, null],
    ["trio", 3, null],
  ] as const)("round-trips canonical %s rows through TipTap", (rowKind, count, width) => {
    const row = {
      node_id: `node_row${rowKind}0000000000000001`,
      source_refs: ["src_aaaaaaaaaaaaaaaa"],
      block_type: "row" as const,
      row_kind: rowKind,
      left_width_percent: width,
      cells: Array.from({ length: count }, (_, index) => ({
        node_id: `node_cell${rowKind}${index.toString().padStart(12, "0")}`,
        source_refs: ["src_bbbbbbbbbbbbbbbb"],
        blocks: [{
          node_id: `node_block${rowKind}${index.toString().padStart(12, "0")}`,
          source_refs: ["src_cccccccccccccccc"],
          block_type: "paragraph" as const,
          runs: [{
            inline_type: "text" as const,
            text: `${rowKind}-${index}`,
            marks: [],
            href: null,
            style: { color: null, font_size_pt: null, highlight_color: null },
          }],
        }],
      })),
    };
    const document = {
      ...canonicalFixture,
      sections: [{ ...canonicalFixture.sections[0], blocks: [row] }],
    };
    const editor = canonicalResumeDocumentToEditorDocument(document);
    const projectedRow = editor.content?.find((node) => node.type === (
      rowKind === "pair" ? "resumeRow" : rowKind === "meta" ? "resumeMetaRow" : "resumeTrioRow"
    ));
    expect(projectedRow?.content).toHaveLength(count);
    expect(JSON.stringify(projectedRow)).toContain(`node_row${rowKind}0000000000000001`);
    expect(JSON.stringify(projectedRow)).not.toContain(":::");

    const restored = canonicalResumeDocumentFromEditorDocument(editor, document);
    expect(restored.sections[0].blocks[0]).toEqual(row);
  });

  it("persists identity name/headline/contact/avatar add-delete and retains source refs", () => {
    const editor = canonicalResumeDocumentToEditorDocument(canonicalEditingFixture);
    const heading = editor.content?.find((node) => node.type === "heading" && node.attrs?.level === 1)!;
    const headline = editor.content?.find((node) => node.type === "paragraph" && node.content?.some(
      (child) => child.type === "resumeBlockAnchor" && child.attrs?.role === "identity-headline",
    ))!;
    const contacts = editor.content?.find((node) => node.type === "paragraph" && node.content?.some(
      (child) => child.type === "resumeBlockAnchor" && child.attrs?.role === "contact",
    ))!;
    const avatar = editor.content?.find((node) => node.type === "avatarImage")!;
    const nameText = heading.content?.find((child) => child.type === "text");
    if (nameText) nameText.text = "李四";
    headline.content = headline.content?.filter((child) => child.type !== "text");
    contacts.content = [
      {
        type: "resumeBlockAnchor",
        attrs: {
          blockId: "node_eeeeeeeeeeeeeeee",
          role: "contact",
          contactKind: "email",
          label: "邮箱",
          sourceRefs: ["src_emailaaaaaaaaaaa"],
        },
      },
      { type: "text", text: "邮箱：new@example.com" },
      { type: "text", text: " ｜ " },
      {
        type: "resumeBlockAnchor",
        attrs: {
          blockId: "node_9999999999999999",
          role: "contact",
          contactKind: "website",
          label: "网站",
          sourceRefs: [],
        },
      },
      { type: "text", text: "网站：https://example.com" },
    ];
    editor.content = editor.content?.filter((node) => node !== avatar);
    const deleted = canonicalResumeDocumentFromEditorDocument(editor, canonicalEditingFixture);
    expect(deleted.identity.name).toMatchObject({
      node_id: "node_cccccccccccccccc",
      value: "李四",
      source_refs: ["src_nameaaaaaaaaaaaa"],
    });
    expect(deleted.identity.headline).toBeNull();
    expect(deleted.identity.contacts).toEqual([
      expect.objectContaining({
        node_id: "node_eeeeeeeeeeeeeeee",
        value: "new@example.com",
        source_refs: ["src_emailaaaaaaaaaaa"],
      }),
      expect.objectContaining({
        node_id: "node_9999999999999999",
        value: "https://example.com",
        contact_kind: "website",
      }),
    ]);
    expect(deleted.identity.avatar).toBeNull();
    expect(deleted.source_dispositions).toContainEqual({
      source_id: "src_avataraaaaaaaaa",
      outcome: "dropped",
      target_node_ids: [],
      reason_code: "user_removed",
    });

    editor.content?.push({
      type: "avatarImage",
      attrs: {
        src: "/api/resumes/1/assets/new-avatar.png",
        size: 120,
        alt: "新头像",
        systemFallback: false,
        nodeId: "node_8888888888888888",
        sourceRefs: [],
      },
    });
    const added = canonicalResumeDocumentFromEditorDocument(editor, canonicalEditingFixture);
    expect(added.identity.avatar).toMatchObject({
      node_id: "node_8888888888888888",
      src: "/api/resumes/1/assets/new-avatar.png",
      width: 120,
    });
  });

  it("persists section/entry/field/block add-delete-reorder and generates legal ids", () => {
    const editor = canonicalResumeDocumentToEditorDocument(canonicalEditingFixture);
    const content = editor.content ?? [];
    const firstSectionIndex = content.findIndex((node) => node.type === "heading" && node.attrs?.level === 2);
    const identity = content.slice(0, firstSectionIndex);
    const sectionGroups: JSONContent[][] = [];
    let current: JSONContent[] = [];
    for (const node of content.slice(firstSectionIndex)) {
      if (node.type === "heading" && node.attrs?.level === 2) {
        if (current.length) sectionGroups.push(current);
        current = [node];
      } else {
        current.push(node);
      }
    }
    if (current.length) sectionGroups.push(current);
    const work = sectionGroups.find((group) => JSON.stringify(group[0]).includes("node_hhhhhhhhhhhhhhhh"))!;
    const skills = sectionGroups.find((group) => JSON.stringify(group[0]).includes("node_1234567890abcdef"))!;
    const workEntryStarts = work
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.type === "heading" && node.attrs?.level === 3)
      .map(({ index }) => index);
    const firstEntryStart = workEntryStarts[0];
    const secondEntryStart = workEntryStarts[1];
    const firstEntry = work.slice(firstEntryStart, secondEntryStart);
    const firstEntryHeading = firstEntry[0];
    const organization = firstEntry.find((node) => JSON.stringify(node).includes("node_llllllllllllllll"))!;
    const paragraphBlock = firstEntry.find((node) => JSON.stringify(node).includes("node_nnnnnnnnnnnnnnnn"))!;
    const listBlock = firstEntry.find((node) => node.type === "bulletList")!;
    const rowBlock = firstEntry.find((node) => node.type === "resumeRow")!;
    const retainedFields = firstEntry.slice(1).filter((node) => node !== organization);
    const editedFirstEntry = [
      firstEntryHeading,
      ...retainedFields.filter((node) => node !== paragraphBlock && node !== listBlock && node !== rowBlock),
      listBlock,
      rowBlock,
      { type: "paragraph", content: [{ type: "text", text: "新增工作补充" }] },
      { type: "paragraph", content: [{ type: "text", text: "地点：上海" }] },
    ];
    const sectionBlock = work.find((node) => node.content?.some(
      (child) => child.type === "resumeBlockAnchor" && child.attrs?.role === "section-block",
    ))!;
    const newEntry: JSONContent[] = [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "新增经历" }] },
      { type: "paragraph", content: [{ type: "text", text: "角色：负责人" }] },
      { type: "paragraph", content: [{ type: "text", text: "新增内容" }] },
    ];
    const newSection: JSONContent[] = [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "自定义" }] },
      { type: "paragraph", content: [{ type: "text", text: "新章节内容" }] },
    ];
    editor.content = [
      ...identity,
      ...skills,
      work[0],
      ...editedFirstEntry,
      ...newEntry,
      sectionBlock,
    ...newSection,
    ];
    const persisted = canonicalResumeDocumentFromEditorDocument(editor, canonicalEditingFixture);
    expect(persisted.sections.map((section) => section.title?.value)).toEqual(["技能", "工作经历", "自定义"]);
    expect(persisted.sections[1].entries.map((entry) => entry.fields.name?.value)).toEqual(["示例公司", "新增经历"]);
    expect(persisted.sections[1].entries[0].fields.organization).toBeNull();
    expect(persisted.sections[1].entries[0].fields.location?.value).toBe("上海");
    expect(persisted.sections[1].entries[0].blocks.map((block) => block.block_type)).toEqual([
      "bullet_list",
      "row",
      "paragraph",
    ]);
    expect(persisted.sections[1].entries[0].blocks[0].node_id).toBe("node_oooooooooooooooo");
    expect(persisted.sections[1].entries[0].blocks[1].node_id).toBe("node_rrrrrrrrrrrrrrrr");
    expect(persisted.sections[1].entries[0].blocks[2].node_id).toMatch(/^node_[a-z0-9]{16,64}$/u);
    expect(persisted.sections[1].entries[1].node_id).toMatch(/^node_[a-z0-9]{16,64}$/u);
    expect(persisted.sections[1].entries[1].node_id).not.toBe("node_wwwwwwwwwwwwwwww");
    expect(persisted.sections[2].node_id).toMatch(/^node_[a-z0-9]{16,64}$/u);
    expect(persisted.sections[2].node_id).not.toBe("node_4567890abcdef123");
  });

  it("keeps empty paragraphs and updates removed source targets to dropped/user_removed", () => {
    const editor = canonicalResumeDocumentToEditorDocument(canonicalEditingFixture);
    const workHeadingIndex = editor.content?.findIndex((node) => node.type === "heading" && JSON.stringify(node).includes("node_hhhhhhhhhhhhhhhh")) ?? -1;
    editor.content?.splice(workHeadingIndex + 1, 0, { type: "paragraph", content: [] });
    const removedBlockIndex = editor.content?.findIndex((node) => JSON.stringify(node).includes("node_67890abcdef12345")) ?? -1;
    if (removedBlockIndex >= 0) editor.content?.splice(removedBlockIndex, 1);
    const persisted = canonicalResumeDocumentFromEditorDocument(editor, canonicalEditingFixture);
    const work = persisted.sections.find((section) => section.node_id === "node_hhhhhhhhhhhhhhhh")!;
    expect(work.blocks[0]).toMatchObject({ block_type: "paragraph", runs: [] });
    expect(work.blocks[0].node_id).toMatch(/^node_[a-z0-9]{16,64}$/u);
    expect(work.blocks[1].node_id).toBe("node_zzzzzzzzzzzzzzzz");
    expect(persisted.source_dispositions).toContainEqual({
      source_id: "src_removedblockaaaa",
      outcome: "dropped",
      target_node_ids: [],
      reason_code: "user_removed",
    });
    expect(persisted.source_dispositions).toContainEqual({
      source_id: "src_retainedblockaaaa",
      outcome: "mapped",
      target_node_ids: ["node_nnnnnnnnnnnnnnnn"],
      reason_code: null,
    });
  });

  it("fails explicitly for unsupported nested lists and invalid rows", () => {
    const nested = canonicalResumeDocumentToEditorDocument(canonicalEditingFixture);
    const list = nested.content?.find((node) => node.type === "bulletList")!;
    const firstItem = list.content?.[0];
    firstItem?.content?.push({
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "嵌套" }] }] }],
    });
    expect(() => canonicalResumeDocumentFromEditorDocument(nested, canonicalEditingFixture))
      .toThrow(/RESUME_EDITOR_UNSUPPORTED_(NESTED_STRUCTURE|INLINE_NODE)/u);

    const invalidRow = canonicalResumeDocumentToEditorDocument(canonicalEditingFixture);
    const row = invalidRow.content?.find((node) => node.type === "resumeRow")!;
    row.content = row.content?.slice(0, 1);
    expect(() => canonicalResumeDocumentFromEditorDocument(invalidRow, canonicalEditingFixture))
      .toThrow("RESUME_EDITOR_ROW_CARDINALITY");
  });
});

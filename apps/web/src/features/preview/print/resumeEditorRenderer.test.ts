import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { renderResumeEditorDocument } from "./resumeEditorRenderer";

function withRow(row: JSONContent): JSONContent {
  return { type: "doc", content: [row] };
}

function textCell(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

describe("只读简历的职业定位排版", () => {
  const name: JSONContent = {
    type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "张三" }],
  };

  it.each([0, 1, 2])("姓名之后隔 %i 个空行仍保留职业定位样式及局部格式", (blankLines) => {
    const html = renderResumeEditorDocument({
      type: "doc",
      content: [
        name,
        ...Array.from({ length: blankLines }, () => ({
          type: "paragraph", content: [{ type: "resumeBlockAnchor", attrs: { blockId: "node_blank000000000001" } }],
        })),
        {
          type: "paragraph", attrs: { textAlign: "right" },
          content: [{ type: "text", text: "前端工程师", marks: [{ type: "textStyle", attrs: { fontSize: "12pt" } }] }],
        },
        textCell("普通正文"),
      ],
    });
    expect(html).toContain('<p style="text-align:right" class="resume-identity-headline"><span style="font-size:12pt">前端工程师</span></p>');
    expect(html.match(/resume-identity-headline/gu)).toHaveLength(1);
    expect(html).toContain('<p>普通正文</p>');
    expect(html.match(/class="resume-block-anchor"/gu) ?? []).toHaveLength(blankLines);
  });

  it("遇到章节标题或布局块后不把普通正文识别为职业定位", () => {
    for (const separator of [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "项目经历" }] },
      { type: "resumeRow", content: [textCell("项目"), textCell("日期")] },
    ]) {
      const html = renderResumeEditorDocument({ type: "doc", content: [name, separator, textCell("普通正文")] });
      expect(html).not.toContain("resume-identity-headline");
      expect(html).toContain('<p>普通正文</p>');
    }
  });
});

describe("renderResumeEditorDocument 分栏行", () => {
  it("renders avatar with the same portrait ratio as the editor", () => {
    const html = renderResumeEditorDocument({
      type: "doc",
      content: [{ type: "avatarImage", attrs: { src: "/templates/avatar-cat.jpg", size: 94 } }],
    });
    expect(html).toContain("width:94px;height:calc(94px * var(--resume-avatar-height-ratio, 1.4))");
    expect(html).toContain('data-template-avatar="true"');
  });
  it("keeps uploaded photos outside the template avatar framing", () => {
    const html = renderResumeEditorDocument({
      type: "doc",
      content: [{ type: "avatarImage", attrs: { src: "/api/resumes/1/assets/avatar.jpg", size: 94 } }],
    });
    expect(html).not.toContain("data-template-avatar");
  });
  it("2 栏仍是带左右比例的左右分栏", () => {
    const html = renderResumeEditorDocument(withRow({
      type: "resumeRow",
      attrs: { leftWidth: 64 },
      content: [textCell("星河云科技"), textCell("2022.9 – 2026.6")],
    }));

    expect(html).toContain('data-block="pair"');
    expect(html).toContain("--resume-row-left:64%");
    expect(html).toContain('<p class="resume-row-left">星河云科技</p>');
    expect(html).toContain('<p class="resume-row-right">2022.9 – 2026.6</p>');
  });

  it("4 栏按等分逐格输出并携带栏数", () => {
    const html = renderResumeEditorDocument(withRow({
      type: "resumeRow",
      attrs: { leftWidth: 50 },
      content: ["A", "B", "C", "D"].map(textCell),
    }));

    expect(html).toContain('data-block="equal"');
    expect(html).toContain('data-columns="4"');
    expect(html).toContain("--resume-row-columns:4");
    expect(html.match(/class="resume-row-cell"/g)).toHaveLength(4);
    expect(html).not.toContain("resume-row-right");
    expect(html).toContain('<p class="resume-row-cell">A</p>');
    expect(html).toContain('<p class="resume-row-cell">D</p>');
  });

  it("3 栏等分栏同样按等分输出", () => {
    const html = renderResumeEditorDocument(withRow({
      type: "resumeRow",
      attrs: { leftWidth: 50 },
      content: ["A", "B", "C"].map(textCell),
    }));

    expect(html).toContain('data-columns="3"');
    expect(html).toContain("--resume-row-columns:3");
    expect(html.match(/class="resume-row-cell"/g)).toHaveLength(3);
  });

  it("带自定义宽度时输出对应轨道，未调整过则保持等分", () => {
    const custom = renderResumeEditorDocument(withRow({
      type: "resumeRow",
      attrs: { leftWidth: 50, columnWidths: [50, 30, 20] },
      content: ["A", "B", "C"].map(textCell),
    }));
    expect(custom).toContain("--resume-row-tracks:50fr 30fr 20fr");

    const untouched = renderResumeEditorDocument(withRow({
      type: "resumeRow",
      attrs: { leftWidth: 50 },
      content: ["A", "B", "C"].map(textCell),
    }));
    expect(untouched).not.toContain("--resume-row-tracks");

    // 非法的宽度数组退回等分，不影响渲染。
    const invalid = renderResumeEditorDocument(withRow({
      type: "resumeRow",
      attrs: { leftWidth: 50, columnWidths: [40, 40, 40] },
      content: ["A", "B", "C"].map(textCell),
    }));
    expect(invalid).not.toContain("--resume-row-tracks");
  });
});


describe("只读个人信息与编辑器采用同一语义", () => {
  it("姓名后缺少职位描述时，联系方式语义优先于历史相邻识别", () => {
    const html = renderResumeEditorDocument({ type: "doc", content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "张三" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [
        { type: "resumeBlockAnchor", attrs: { blockId: "node_contact000000001", role: "contact" } },
        { type: "text", text: "demo@example.com" },
      ] },
      textCell("普通正文"),
    ] });
    expect(html).toContain('class="resume-identity-contacts"');
    expect(html).not.toContain('class="resume-identity-headline"');
    expect(html).toContain('<p>普通正文</p>');
  });
  it.each(["contact", "identity-headline"])("不依赖姓名或相邻段落识别 %s", (role) => {
    const root = document.createElement("div");
    root.innerHTML = renderResumeEditorDocument({ type: "doc", content: [{
      type: "paragraph", content: [
        { type: "resumeBlockAnchor", attrs: { blockId: "node_identity00000001", role } },
        { type: "text", text: "示例信息" },
      ],
    }] });
    const paragraph = root.querySelector("p")!;
    expect(paragraph.className).toBe(role === "contact" ? "resume-identity-contacts" : "resume-identity-headline");
    expect(paragraph.textContent).toBe("示例信息");
  });
});

describe("只读分栏与行内图片", () => {
  it.each(["resumeRow", "resumeTrioRow", "resumeMetaRow"])("%s 保留格内显式对齐", (type) => {
    const count = type === "resumeMetaRow" ? 4 : type === "resumeTrioRow" ? 3 : 2;
    const html = renderResumeEditorDocument(withRow({ type, content: Array.from({ length: count }, (_, i) => ({
      ...textCell(`第${i + 1}栏`), attrs: { textAlign: "center" },
    })) }));
    expect(html.match(/style="text-align:center"/gu)).toHaveLength(count);
  });
  it("缺省图片高度使用宽高比，并保留连续空格文字", () => {
    const html = renderResumeEditorDocument(withRow({ type: "paragraph", content: [
      { type: "text", text: "甲    乙" },
      { type: "inlineImage", attrs: { src: "/templates/test.png", width: 120, height: null, aspectRatio: 3 } },
    ] }));
    expect(html).toContain("甲    乙");
    expect(html).toContain('width:120px;height:40px');
  });
  it("图片显式高度优先于宽高比", () => {
    const html = renderResumeEditorDocument(withRow({ type: "paragraph", content: [
      { type: "inlineImage", attrs: { src: "/templates/test.png", width: 120, height: 60, aspectRatio: 3 } },
    ] }));
    expect(html).toContain('width:120px;height:60px');
  });
});

import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { renderResumeEditorDocument } from "./resumeEditorRenderer";

function withRow(row: JSONContent): JSONContent {
  return { type: "doc", content: [row] };
}

function textCell(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

describe("renderResumeEditorDocument 分栏行", () => {
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
});

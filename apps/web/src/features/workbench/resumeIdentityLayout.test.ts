import { describe, expect, it } from "vitest";
import { defaultCanonicalDocument } from "../../api/resumeContract";
import { resetEditorIdentityAlignment, resetResumeIdentityAlignment } from "./resumeIdentityLayout";

describe("template identity alignment", () => {
  it("resets only identity alignment and does not mutate the original document", () => {
    const data = structuredClone(defaultCanonicalDocument);
    data.identity.name = { node_id: "node_name000000000001", source_refs: [], value: "李示例", align: "right" };
    const result = resetResumeIdentityAlignment(data);
    expect(result.identity.name?.align).toBeNull();
    expect(data.identity.name.align).toBe("right");
    expect(result.sections).toBe(data.sections);
  });

  it("concurrent edits keep their new text and body alignment after a switch", () => {
    const data = { type: "doc", content: [{ type: "resumeColumns", content: [{ type: "resumeColumn", content: [
      { type: "paragraph", attrs: { textAlign: "center" }, content: [
        { type: "resumeBlockAnchor", attrs: { role: "contact" } },
        { type: "text", text: "new@example.com" },
      ] },
      { type: "paragraph", attrs: { textAlign: "right" }, content: [{ type: "text", text: "最新正文" }] },
    ] }] }] };
    const result = resetEditorIdentityAlignment(data);
    const nodes = result.content![0].content![0].content!;
    expect(nodes[0].attrs?.textAlign).toBeNull();
    expect(nodes[0].content![1].text).toBe("new@example.com");
    expect(nodes[1]).toEqual(data.content[0].content[0].content[1]);
    expect(data.content[0].content[0].content[0].attrs.textAlign).toBe("center");
  });

  it("does not reset a level-one heading in the body", () => {
    const name = { type: "heading", attrs: { level: 1, textAlign: "right" }, content: [
      { type: "resumeBlockAnchor", attrs: { role: "identity-name" } },
      { type: "text", text: "张三" },
    ] };
    const heading = { type: "heading", attrs: { level: 1, textAlign: "center" }, content: [
      { type: "resumeBlockAnchor", attrs: { role: "section-block" } },
      { type: "text", text: "正文标题" },
    ] };
    const result = resetEditorIdentityAlignment({ type: "doc", content: [name, heading] });
    expect(result.content![0].attrs?.textAlign).toBeNull();
    expect(result.content![1]).toEqual(heading);
  });
});

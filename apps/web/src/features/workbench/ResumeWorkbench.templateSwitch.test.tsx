import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type ResumeRecord, type ResumeTemplate } from "../../api/client";
import {
  defaultCanonicalDocument,
  defaultCanonicalPresentation,
  styleToEditorSettings,
  type CanonicalResumeDocument,
  type CanonicalResumePresentation,
  type LayoutPlan,
} from "../../api/resumeContract";
import { defaultSettings, useResumeStore } from "../../store/resumeStore";
import { ResumeWorkbench } from "./ResumeWorkbench";
import { resumeDocumentToEditorDocument } from "./resumeEditorPersistence";
import { composeEditorDocumentForLayoutPlan } from "./templateLayout";

// Keep the real editor; the selection tooltip's browser-only positioning is
// unrelated to applying a template and is not available in jsdom.
vi.mock("@tiptap/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tiptap/react")>(),
  BubbleMenu: () => null,
}));

function presentation(columns: boolean): CanonicalResumePresentation {
  const templateKey = columns ? "administrative-sidebar-cn" : "original-offset-cn";
  const snapshot = defaultCanonicalPresentation.template_snapshot;
  return {
    ...defaultCanonicalPresentation,
    template_scoped: { [templateKey]: {} },
    template_snapshot: {
      ...snapshot,
      template_key: templateKey,
      regions: columns ? [
        { region_id: "sidebar", region_kind: "sidebar", order: 0 },
        { region_id: "main", region_kind: "main", order: 1 },
      ] : snapshot.regions,
      slots: columns ? [
        { slot_id: "identity", region_id: "sidebar", accepts: ["identity"], universal_fallback: false, order: 0 },
        { ...snapshot.slots[0], slot_id: "body" },
      ] : snapshot.slots,
    },
  };
}

function layout(data: CanonicalResumeDocument, style: CanonicalResumePresentation): LayoutPlan {
  const columns = style.template_snapshot.regions.length === 2;
  const identity = { node_id: data.identity.node_id, semantic_kind: "identity" as const, slot_id: columns ? "identity" : "main_content" };
  return {
    schema_version: "layout-plan.v1",
    content_sha256: "2".repeat(64),
    template_key: style.template_snapshot.template_key,
    regions: [
      ...(columns ? [{ region_id: "sidebar", order: 0, nodes: [identity] }] : []),
      { region_id: "main", order: columns ? 1 : 0, nodes: [
        ...(!columns ? [identity] : []),
        ...data.sections.map(section => ({ node_id: section.node_id, semantic_kind: section.semantic_kind, slot_id: columns ? "body" : "main_content" })),
      ] },
    ],
  };
}

const originalState = useResumeStore.getState();
afterEach(() => {
  useResumeStore.setState(originalState, true);
  vi.restoreAllMocks();
});

describe("编辑器中切换模板", () => {
  it.each([
    { fromColumns: false, headline: true },
    { fromColumns: true, headline: true },
    { fromColumns: false, headline: false },
    { fromColumns: true, headline: false },
  ])("同步切换实际编辑内容和主题，保留正文格式：$fromColumns / $headline", async ({ fromColumns, headline }) => {
    const data: CanonicalResumeDocument = {
      ...defaultCanonicalDocument,
      identity: {
        ...defaultCanonicalDocument.identity,
        name: { node_id: "node_name000000000001", value: "张三", source_refs: [], align: "right" },
        headline: headline ? { node_id: "node_headline000000001", value: "工程师", source_refs: [], align: "center" } : null,
        contacts: [{ node_id: "node_contact000000001", value: "demo@example.com", contact_kind: "email", source_refs: [], align: "right" }],
      },
      sections: [{
        node_id: "node_section000000001", semantic_kind: "work", source_refs: [], entries: [],
        title: { node_id: "node_title00000000001", value: "工作经历", source_refs: [] },
        blocks: [{
          node_id: "node_block00000000001", block_type: "paragraph", align: "center", source_refs: [],
          runs: [{ inline_type: "text", text: "保留手动格式的正文", marks: ["bold"], href: null, style: { color: "#345678", font_size_pt: 12, highlight_color: null } }],
        }],
      }],
    };
    const sourceStyle = presentation(fromColumns);
    const targetStyle = presentation(!fromColumns);
    const target: ResumeTemplate = {
      id: "2", key: targetStyle.template_snapshot.template_key, name: "目标模板", description: null,
      style_categories: [], use_cases: [], data, style: targetStyle, layout_plan: layout(data, targetStyle),
      switchable: true, incompatibility_reason: null,
    };
    const editorContent = composeEditorDocumentForLayoutPlan(resumeDocumentToEditorDocument(data)!, data, layout(data, sourceStyle), sourceStyle.template_snapshot);
    useResumeStore.setState({
      activeResumeId: "1", title: "虚构测试简历", data, style: sourceStyle, editorContent,
      settings: { ...defaultSettings, ...styleToEditorSettings(sourceStyle) },
      lockVersion: 1, dirty: false, saveStatus: "saved", editVersion: 0,
      versionOperationPending: false, proposalApplyingResumeId: null, proposalContentRevision: 0,
    });
    vi.spyOn(api, "listResumeTemplates").mockResolvedValue({ templates: [target] });
    const apply = vi.spyOn(api, "applyResumeTemplate").mockImplementation(async (_id, request) => {
      const updated = request.data!;
      const resume: ResumeRecord = {
        id: "1", title: "虚构测试简历", source_type: "blank", template_id: "2", lock_version: 2,
        data: updated, style: targetStyle, layout_plan: layout(updated, targetStyle),
        created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:01Z",
      };
      return { resume };
    });
    const user = userEvent.setup();
    render(<ResumeWorkbench />);
    const paper = screen.getByRole("article", { name: "可编辑简历页面" });
    expect(paper.querySelector(".resume-identity-contacts")).toHaveStyle({ textAlign: "right" });
    await user.click(screen.getByRole("button", { name: "简历模板" }));
    await user.click(await screen.findByRole("button", { name: "应用模板：目标模板" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "目标模板（当前模板）" })).toBeInTheDocument());

    expect(apply).toHaveBeenCalledOnce();
    expect(paper).toHaveClass(!fromColumns ? "theme-administrative-sidebar" : "theme-original-offset");
    const contacts = paper.querySelector(".resume-identity-contacts")!;
    expect(contacts).toHaveTextContent("demo@example.com");
    expect((contacts as HTMLElement).style.textAlign).toBe("");
    expect(contacts.closest('[data-column="sidebar"]') !== null).toBe(!fromColumns);
    expect(paper.querySelectorAll(".resume-identity-headline")).toHaveLength(headline ? 1 : 0);
    expect(paper.querySelector("h1")?.style.textAlign).toBe("");
    const body = within(paper).getByText("保留手动格式的正文");
    expect(body.tagName).toBe("STRONG");
    expect(body.closest("p")).toHaveStyle({ textAlign: "center" });
    expect(body.closest("span")).toHaveStyle({ color: "#345678", fontSize: "12pt" });
    expect(paper.querySelector('[contenteditable="true"]')).toBeInTheDocument();
  });
});

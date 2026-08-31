import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { api, type ResumeImportSummary, type ResumeRecord } from "../api/client";
import {
  defaultCanonicalDocument,
  defaultCanonicalPresentation,
  type CanonicalResumeDocument,
  type CanonicalResumePresentation,
  type LayoutPlan,
} from "../api/resumeContract";
import { resumeDocumentToEditorDocument } from "../features/workbench/resumeEditorPersistence";
import { defaultSettings, useResumeStore } from "./resumeStore";

function editorDocument(title: string): JSONContent {
  return {
    type: "doc",
    content: [{
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: title }],
    }],
  };
}

function canonicalDocument(markdown: string): CanonicalResumeDocument {
  const title = markdown.replace(/^#+\s*/, "");
  return {
    ...defaultCanonicalDocument,
    sections: title ? [{
      node_id: "node_section000000001",
      semantic_kind: "custom",
      title: { node_id: "node_title0000000001", value: title, source_refs: [] },
      entries: [],
      blocks: [],
      source_refs: [],
    }] : [],
  };
}

function canonicalStyle(
  templateKey = "classic-cn",
  options: { accentColor?: string; fontSize?: number; lineHeight?: number; smartOnePage?: boolean } = {},
): CanonicalResumePresentation {
  return {
    ...defaultCanonicalPresentation,
    portable: { smart_one_page: options.smartOnePage ?? false },
    template_scoped: { [templateKey]: {} },
    template_snapshot: {
      ...defaultCanonicalPresentation.template_snapshot,
      template_key: templateKey,
      tokens: {
        ...defaultCanonicalPresentation.template_snapshot.tokens,
        accent_color: options.accentColor ?? defaultCanonicalPresentation.template_snapshot.tokens.accent_color,
        font_size_pt: options.fontSize ?? defaultCanonicalPresentation.template_snapshot.tokens.font_size_pt,
        line_height: options.lineHeight ?? defaultCanonicalPresentation.template_snapshot.tokens.line_height,
      },
    },
  };
}

function canonicalLayoutPlan(
  data: CanonicalResumeDocument,
  templateKey = "classic-cn",
): LayoutPlan {
  return {
    schema_version: "layout-plan.v1",
    content_sha256: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    template_key: templateKey,
    regions: [{
      region_id: "main",
      order: 0,
      nodes: [
        {
          node_id: data.identity.node_id,
          semantic_kind: "identity",
          slot_id: "main_content",
        },
        ...data.sections.map((section) => ({
          node_id: section.node_id,
          semantic_kind: section.semantic_kind,
          slot_id: "main_content",
        })),
      ],
    }],
  };
}

function record(lockVersion: number, markdown: string, smartOnePage = false): ResumeRecord {
  return {
    id: "1",
    title: "测试简历",
    source_type: "blank",
    template_id: null,
    lock_version: lockVersion,
    data: canonicalDocument(markdown),
    style: canonicalStyle("classic-cn", { smartOnePage }),
    created_at: "2026-07-27T00:00:00Z",
    updated_at: `2026-07-27T00:00:0${lockVersion}Z`,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function importTask(
  id: string,
  overrides: Partial<ResumeImportSummary> = {},
): ResumeImportSummary {
  return {
    id,
    source_filename: `张三-${id}.docx`,
    source_file_format: "docx",
    upload_status: "succeeded",
    upload_duration_ms: 12,
    parse_status: "processing",
    parse_duration_ms: null,
    result_resume_id: null,
    created_at: "2026-08-19T00:00:00Z",
    updated_at: "2026-08-19T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  useResumeStore.setState({
    resumes: [],
    activeImports: [],
    failedImports: [],
    versions: [],
    versionsLoading: false,
    versionOperationPending: false,
    importWarningsByResumeId: {},
    activeResumeId: "1",
    lockVersion: 1,
    data: defaultCanonicalDocument,
    style: defaultCanonicalPresentation,
    title: "测试简历",
    markdown: "# 第一次编辑",
    editorContent: "# 第一次编辑",
    settings: defaultSettings,
    splitRatio: 0.4,
    previewScale: 1,
    dirty: true,
    editVersion: 1,
    saveStatus: "idle",
    error: null,
  });
});

describe("resume save serialization", () => {
  it("从 ResumeRecord 更新本地摘要时保留服务端布局计划", async () => {
    const data = canonicalDocument("# 带布局计划的简历");
    const layoutPlan = canonicalLayoutPlan(data);
    const renamed = {
      ...record(2, "# 带布局计划的简历"),
      title: "已更新名称",
      data,
      layout_plan: layoutPlan,
    };
    useResumeStore.setState({
      resumes: [{
        id: "1",
        title: "旧名称",
        source_type: "blank",
        lock_version: 1,
        created_at: renamed.created_at,
        updated_at: "2026-07-27T00:00:01Z",
      }],
    });
    vi.spyOn(api, "updateResume").mockResolvedValue({ resume: renamed });

    await useResumeStore.getState().renameResume("1", "已更新名称");

    expect(useResumeStore.getState().resumes[0].preview).toMatchObject({
      data,
      style: renamed.style,
      layout_plan: layoutPlan,
    });
  });

  it("没有本地并发编辑时用响应中与数据匹配的布局计划重组编辑树", async () => {
    const data = canonicalDocument("# 有效布局计划");
    const style = canonicalStyle("creative-orange-cn", {
      accentColor: "#F97316",
      fontSize: 11,
      lineHeight: 1.4,
    });
    const layoutPlan = canonicalLayoutPlan(data, style.template_snapshot.template_key);
    const editor = resumeDocumentToEditorDocument(data);
    if (!editor) throw new Error("TEST_FIXTURE_INVALID");
    const switched = {
      ...record(2, "# 有效布局计划"),
      data,
      style,
      template_id: "9",
      layout_plan: layoutPlan,
    };
    useResumeStore.setState({
      data,
      editorContent: editor,
      markdown: "# 有效布局计划",
      dirty: false,
    });
    vi.spyOn(api, "applyResumeTemplate").mockResolvedValue({ resume: switched });

    await useResumeStore.getState().applyTemplate("9", editor);

    expect(useResumeStore.getState()).toMatchObject({
      style,
      editorContent: expect.objectContaining({ type: "doc" }),
      dirty: false,
    });
    expect(JSON.stringify(useResumeStore.getState().editorContent)).toContain("有效布局计划");
    expect(useResumeStore.getState().resumes[0].preview?.layout_plan).toEqual(layoutPlan);
  });

  it("通过原子接口切换模板并保留服务端返回的规范内容", async () => {
    const currentData = canonicalDocument("# 保留的正文");
    const currentEditor = resumeDocumentToEditorDocument(currentData);
    if (!currentEditor) throw new Error("TEST_FIXTURE_INVALID");
    const templateStyle = canonicalStyle("creative-orange-cn", {
      accentColor: "#F97316",
      fontSize: 11,
      lineHeight: 1.4,
    });
    useResumeStore.setState({
      data: currentData,
      markdown: "# 保留的正文",
      editorContent: currentEditor,
      dirty: false,
      editVersion: 4,
      saveStatus: "saved",
    });
    const switched = {
      ...record(2, "# 保留的正文"),
      template_id: "9",
      data: currentData,
      style: templateStyle,
    };
    const apply = vi
      .spyOn(api, "applyResumeTemplate")
      .mockResolvedValue({ resume: switched });

    await useResumeStore.getState().applyTemplate("9", currentEditor);

    expect(apply).toHaveBeenCalledWith("1", expect.objectContaining({
      template_id: "9",
      base_lock_version: 1,
      title: "测试简历",
      data: expect.objectContaining({
        sections: expect.arrayContaining([
          expect.objectContaining({ semantic_kind: "custom" }),
        ]),
      }),
    }));
    expect(useResumeStore.getState()).toMatchObject({
      data: currentData,
      style: templateStyle,
      lockVersion: 2,
      settings: {
        theme: "creative-orange",
        fontSize: 11,
        lineHeight: 1.4,
      },
      dirty: false,
      saveStatus: "saved",
    });
  });

  it("用一次原子请求提交当前编辑器内容而不预先调用普通保存", async () => {
    const update = vi.spyOn(api, "updateResume");
    const apply = vi.spyOn(api, "applyResumeTemplate").mockResolvedValue({
      resume: { ...record(2, "# 当前编辑"), template_id: "9" },
    });
    await useResumeStore.getState().applyTemplate("9", editorDocument("当前编辑"));

    expect(update).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][1]).toMatchObject({
      template_id: "9",
      base_lock_version: 1,
      data: expect.objectContaining({
        schema_version: "canonical-resume.v1",
      }),
    });
  });

  it("切换请求返回前离开当前简历时释放全局操作锁", async () => {
    const applyResponse = deferred<{ resume: ResumeRecord }>();
    vi
      .spyOn(api, "applyResumeTemplate")
      .mockImplementationOnce(() => applyResponse.promise);
    useResumeStore.setState({ dirty: false, saveStatus: "saved" });

    const switching = useResumeStore.getState().applyTemplate("9", editorDocument("第一次编辑"));
    await vi.waitFor(() => expect(useResumeStore.getState().versionOperationPending).toBe(true));
    useResumeStore.setState({ activeResumeId: "2" });
    applyResponse.resolve({ resume: { ...record(2, "# 已切换"), template_id: "9" } });

    await switching;

    expect(useResumeStore.getState()).toMatchObject({
      activeResumeId: "2",
      versionOperationPending: false,
      saveStatus: "idle",
    });
  });

  it("切换请求期间出现的新编辑不会被成功响应覆盖", async () => {
    const applyResponse = deferred<{ resume: ResumeRecord }>();
    const targetStyle = canonicalStyle("creative-orange-cn", { accentColor: "#F97316" });
    vi
      .spyOn(api, "applyResumeTemplate")
      .mockImplementationOnce(() => applyResponse.promise);

    const switching = useResumeStore.getState().applyTemplate("9", editorDocument("第一次编辑"));
    await vi.waitFor(() => expect(useResumeStore.getState().versionOperationPending).toBe(true));
    useResumeStore.getState().setEditorContent(editorDocument("请求期间的新编辑"));
    applyResponse.resolve({
      resume: { ...record(2, "# 第一次编辑"), template_id: "9", style: targetStyle },
    });

    await switching;

    expect(JSON.stringify(useResumeStore.getState().editorContent)).toContain("请求期间的新编辑");
    expect(useResumeStore.getState()).toMatchObject({
      lockVersion: 2,
      style: targetStyle,
      dirty: true,
      saveStatus: "idle",
      versionOperationPending: false,
      error: null,
    });
  });

  it("并发编辑时不把旧响应的布局计划套到最新编辑树，并保留可继续保存的 dirty 状态", async () => {
    const applyResponse = deferred<{ resume: ResumeRecord }>();
    const persistedData = canonicalDocument("# 请求开始时的正文");
    const newerData: CanonicalResumeDocument = {
      ...persistedData,
      sections: [
        ...persistedData.sections,
        {
          node_id: "node_section000000002",
          semantic_kind: "custom",
          title: { node_id: "node_title0000000002", value: "并发新增章节", source_refs: [] },
          entries: [],
          blocks: [],
          source_refs: [],
        },
      ],
    };
    const targetStyle = canonicalStyle("creative-orange-cn", { accentColor: "#F97316" });
    const responsePlan = canonicalLayoutPlan(persistedData, targetStyle.template_snapshot.template_key);
    vi.spyOn(api, "applyResumeTemplate").mockImplementationOnce(() => applyResponse.promise);

    useResumeStore.setState({
      data: persistedData,
      editorContent: "# 请求开始时的正文",
      markdown: "# 请求开始时的正文",
      dirty: false,
      editVersion: 10,
    });
    const switching = useResumeStore.getState().applyTemplate("9", editorDocument("请求开始时的正文"));
    await vi.waitFor(() => expect(useResumeStore.getState().versionOperationPending).toBe(true));

    useResumeStore.setState({
      data: newerData,
      editorContent: "# 并发编辑后的正文",
      markdown: "# 并发编辑后的正文",
      dirty: true,
      editVersion: 11,
    });
    applyResponse.resolve({
      resume: {
        ...record(2, "# 请求开始时的正文"),
        data: persistedData,
        style: targetStyle,
        template_id: "9",
        layout_plan: responsePlan,
      },
    });

    await expect(switching).resolves.toBeUndefined();

    expect(useResumeStore.getState()).toMatchObject({
      data: newerData,
      editorContent: "# 并发编辑后的正文",
      style: targetStyle,
      dirty: true,
      saveStatus: "idle",
      versionOperationPending: false,
    });
    // The card remains the last persisted snapshot, so its plan is not paired
    // with the newer unsaved data.
    expect(useResumeStore.getState().resumes[0].preview).toMatchObject({
      data: persistedData,
      layout_plan: responsePlan,
    });
  });

  it("旧简历的延迟响应不会释放新简历正在使用的操作锁", async () => {
    const firstResponse = deferred<{ resume: ResumeRecord }>();
    const secondResponse = deferred<{ resume: ResumeRecord }>();
    vi.spyOn(api, "applyResumeTemplate")
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);
    useResumeStore.setState({ dirty: false, saveStatus: "saved" });

    const first = useResumeStore.getState().applyTemplate("8", editorDocument("第一次编辑"));
    await vi.waitFor(() => expect(useResumeStore.getState().versionOperationPending).toBe(true));
    useResumeStore.setState({
      activeResumeId: "2",
      dirty: false,
      saveStatus: "saved",
      versionOperationPending: false,
    });
    const second = useResumeStore.getState().applyTemplate("9", editorDocument("第二份简历"));
    await vi.waitFor(() => expect(useResumeStore.getState().versionOperationPending).toBe(true));

    firstResponse.resolve({ resume: { ...record(2, "# 旧响应"), template_id: "8" } });
    await first;
    expect(useResumeStore.getState().versionOperationPending).toBe(true);

    secondResponse.resolve({
      resume: { ...record(2, "# 新响应"), id: "2", template_id: "9" },
    });
    await second;
    expect(useResumeStore.getState()).toMatchObject({
      activeResumeId: "2",
      versionOperationPending: false,
      saveStatus: "saved",
    });
  });

  it("uses the refreshed lock version when another edit is saved during an in-flight request", async () => {
    const firstResponse = deferred<{ resume: ResumeRecord }>();
    const update = vi
      .spyOn(api, "updateResume")
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValueOnce({ resume: record(3, "# 第二次编辑") });

    const firstSave = useResumeStore.getState().saveCurrentResume();
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    useResumeStore.getState().setMarkdown("# 第二次编辑");
    const secondSave = useResumeStore.getState().saveCurrentResume();
    firstResponse.resolve({ resume: record(2, "# 第一次编辑") });

    await Promise.all([firstSave, secondSave]);

    expect(update.mock.calls[0][1].base_lock_version).toBe(1);
    expect(update.mock.calls[1][1].base_lock_version).toBe(2);
    expect(useResumeStore.getState()).toMatchObject({
      lockVersion: 3,
      markdown: "## 第二次编辑",
      dirty: false,
      saveStatus: "saved",
      error: null,
    });
  });

  it("恢复历史版本时不创建或保存新的版本", async () => {
    const calls: string[] = [];
    const update = vi.spyOn(api, "updateResume");
    const create = vi.spyOn(api, "createVersion");
    vi.spyOn(api, "restoreVersion").mockImplementation(async () => {
      calls.push("restore");
      return { resume: record(3, "# 历史版本", true) };
    });
    vi.spyOn(api, "listVersions").mockResolvedValue({ versions: [] });

    await useResumeStore.getState().restoreVersion(1);

    expect(calls).toEqual(["restore"]);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(useResumeStore.getState()).toMatchObject({
      lockVersion: 3,
      markdown: "## 历史版本",
      dirty: false,
      versionOperationPending: false,
      settings: { smartOnePage: true },
    });
  });
});

describe("resume deletion", () => {
  beforeEach(() => {
    useResumeStore.setState({
      resumes: [
        {
          id: "1",
          title: "待删除简历",
          source_type: "blank",
          lock_version: 1,
          created_at: "2026-07-27T00:00:00Z",
          updated_at: "2026-07-27T00:00:00Z",
        },
        {
          id: "2",
          title: "保留简历",
          source_type: "blank",
          lock_version: 1,
          created_at: "2026-07-27T00:00:00Z",
          updated_at: "2026-07-27T00:00:00Z",
        },
      ],
    });
  });

  it("只在后端确认删除后移除本地卡片", async () => {
    vi.spyOn(api, "deleteResume").mockResolvedValue({ deleted: true });

    await useResumeStore.getState().deleteResume("1");

    expect(useResumeStore.getState().resumes.map((resume) => resume.id)).toEqual(["2"]);
  });

  it("删除失败时保留本地卡片", async () => {
    vi.spyOn(api, "deleteResume").mockRejectedValue(new Error("HTTP_500"));

    await expect(useResumeStore.getState().deleteResume("1")).rejects.toThrow("HTTP_500");

    expect(useResumeStore.getState().resumes.map((resume) => resume.id)).toEqual(["1", "2"]);
  });
});

describe("resume rename", () => {
  it("使用摘要中的锁版本更新名称并刷新本地摘要", async () => {
    useResumeStore.setState({
      resumes: [
        {
          id: "1",
          title: "旧名称",
          source_type: "blank",
          lock_version: 3,
          created_at: "2026-07-27T00:00:00Z",
          updated_at: "2026-07-27T00:00:03Z",
        },
      ],
    });
    const renamed = { ...record(4, "# 第一次编辑"), title: "新名称" };
    vi.spyOn(api, "updateResume").mockResolvedValue({ resume: renamed });

    await useResumeStore.getState().renameResume("1", "新名称");

    expect(api.updateResume).toHaveBeenCalledWith("1", {
      title: "新名称",
      base_lock_version: 3,
    });
    expect(useResumeStore.getState()).toMatchObject({
      title: "新名称",
      lockVersion: 4,
      resumes: [expect.objectContaining({ id: "1", title: "新名称", lock_version: 4 })],
    });
  });
});

describe("resume import", () => {
  it("异步导入受理后加入活动任务但不创建本地正式简历", async () => {
    const file = new File(["# 导入的简历"], "resume.md", { type: "text/markdown" });
    vi.spyOn(api, "importResume").mockResolvedValue({
      import: {
        id: "3",
        source_filename: "resume.md",
        source_file_format: "md",
        upload_status: "succeeded",
        upload_duration_ms: 12,
        parse_status: "processing",
        parse_duration_ms: null,
        result_resume_id: null,
        created_at: "2026-08-08T00:00:00Z",
        updated_at: "2026-08-08T00:00:00Z",
      },
    });

    const result = await useResumeStore.getState().importResume(file, "8", "产品经理简历");

    expect(api.importResume).toHaveBeenCalledWith(
      expect.objectContaining({ name: "产品经理简历.md" }),
      "8",
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(result).toBe("3");
    expect(useResumeStore.getState().resumes).toEqual([]);
    expect(useResumeStore.getState().activeImports).toContainEqual(
      expect.objectContaining({ id: "3", source_filename: "resume.md" }),
    );
    expect(useResumeStore.getState().activeResumeId).toBe("1");
  });

  it("浏览器不提供 crypto 时仍生成规范幂等键并发送导入请求", async () => {
    const file = new File(["# 张三"], "resume.md", { type: "text/markdown" });
    const importResume = vi.spyOn(api, "importResume").mockResolvedValue({
      import: importTask("3", {
        source_filename: "resume.md",
        source_file_format: "md",
      }),
    });
    vi.stubGlobal("crypto", undefined);

    try {
      await useResumeStore.getState().importResume(file, "8");
    } finally {
      vi.unstubAllGlobals();
    }

    expect(importResume).toHaveBeenCalledWith(
      file,
      "8",
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    );
  });

  it("浏览器不提供 randomUUID 时使用随机字节生成 UUID v4", async () => {
    const file = new File(["# 张三"], "resume.md", { type: "text/markdown" });
    const importResume = vi.spyOn(api, "importResume").mockResolvedValue({
      import: importTask("4", {
        source_filename: "resume.md",
        source_file_format: "md",
      }),
    });
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0);
        return bytes;
      },
    });

    try {
      await useResumeStore.getState().importResume(file, "8");
    } finally {
      vi.unstubAllGlobals();
    }

    expect(importResume).toHaveBeenCalledWith(
      file,
      "8",
      "00000000-0000-4000-8000-000000000000",
    );
  });

  it("导入提示按简历隔离并可关闭", () => {
    useResumeStore.setState({
      importWarningsByResumeId: {
        "1": ["pdf_low_text_quality"],
        "2": ["pdf_ocr_applied"],
      },
    });

    useResumeStore.getState().dismissImportWarnings("1");

    expect(useResumeStore.getState().importWarningsByResumeId).toEqual({
      "2": ["pdf_ocr_applied"],
    });
  });

  it("导入失败时保留原有列表和当前简历", async () => {
    const existing = {
      id: "1",
      title: "测试简历",
      source_type: "blank" as const,
      lock_version: 1,
      created_at: "2026-07-27T00:00:00Z",
      updated_at: "2026-07-27T00:00:01Z",
    };
    useResumeStore.setState({ resumes: [existing] });
    const file = new File(["# 新简历"], "resume.md", { type: "text/markdown" });
    vi.spyOn(api, "importResume").mockRejectedValue(new Error("HTTP_500"));

    await expect(useResumeStore.getState().importResume(file, "8")).rejects.toThrow("HTTP_500");

    expect(useResumeStore.getState().activeResumeId).toBe("1");
    expect(useResumeStore.getState().resumes).toEqual([existing]);
  });

  it("轮询处理中任务时只更新对应任务", async () => {
    const first = importTask("3");
    const second = importTask("4");
    useResumeStore.setState({ activeImports: [first, second] });
    vi.spyOn(api, "getResumeImport").mockResolvedValue({
      import: { ...first, updated_at: "2026-08-19T00:00:01Z" },
    });

    await useResumeStore.getState().pollResumeImport("3");

    expect(useResumeStore.getState().activeImports).toEqual([
      expect.objectContaining({ id: "3", updated_at: "2026-08-19T00:00:01Z" }),
      second,
    ]);
  });

  it("轮询发现失败终态时停止活动展示并加入失败列表", async () => {
    const processing = importTask("3");
    const failed = importTask("3", {
      parse_status: "failed",
      parse_duration_ms: 820,
    });
    useResumeStore.setState({ activeImports: [processing] });
    vi.spyOn(api, "getResumeImport").mockResolvedValue({ import: failed });

    await useResumeStore.getState().pollResumeImport("3");

    expect(useResumeStore.getState().activeImports).toEqual([]);
    expect(useResumeStore.getState().failedImports).toEqual([failed]);
  });

  it("轮询发现成功终态时用一次 overview 刷新正式简历并移除任务", async () => {
    const processing = importTask("3");
    const succeeded = importTask("3", {
      parse_status: "succeeded",
      parse_duration_ms: 910,
      result_resume_id: "9",
    });
    const resume = {
      id: "9",
      title: "张三",
      source_type: "import" as const,
      lock_version: 1,
      created_at: "2026-08-19T00:00:01Z",
      updated_at: "2026-08-19T00:00:01Z",
    };
    useResumeStore.setState({ activeImports: [processing] });
    vi.spyOn(api, "getResumeImport").mockResolvedValue({ import: succeeded });
    vi.spyOn(api, "getResumeOverview").mockResolvedValue({
      resumes: [resume],
      active_imports: [],
      failed_imports: [],
      next_failed_cursor: null,
    });

    await useResumeStore.getState().pollResumeImport("3");

    expect(api.getResumeOverview).toHaveBeenCalledTimes(1);
    expect(useResumeStore.getState()).toMatchObject({
      resumes: [resume],
      activeImports: [],
      failedImports: [],
    });
  });
});

describe("account profile sync and password change", () => {
  it("syncProfile 合并资料到当前用户", () => {
    useResumeStore.setState({
      user: { id: "1", email: "user@example.test", nickname: "旧昵称", is_admin: false },
    });
    useResumeStore.getState().syncProfile({
      id: "1",
      email: "user@example.test",
      nickname: "新昵称",
      is_admin: false,
      avatar_url: "/api/assets/users/1/assets/avatar",
      wechat_status: "unbound",
      wechat_bound_at: null,
    });
    expect(useResumeStore.getState().user).toMatchObject({
      nickname: "新昵称",
      avatar_url: "/api/assets/users/1/assets/avatar",
    });
  });

  it("syncProfile 在无用户时不修改状态", () => {
    useResumeStore.setState({ user: null });
    useResumeStore.getState().syncProfile({
      id: "1",
      email: "user@example.test",
      nickname: "新昵称",
      is_admin: false,
      avatar_url: null,
      wechat_status: "unbound",
      wechat_bound_at: null,
    });
    expect(useResumeStore.getState().user).toBeNull();
  });

});

describe("resume version deletion", () => {
  beforeEach(() => {
    useResumeStore.setState({
      versions: [
        { id: "3", version_no: 3, name: "第三版", reason: "manual", created_at: "2026-07-27T00:03:00Z" },
        { id: "2", version_no: 2, name: "第二版", reason: "manual", created_at: "2026-07-27T00:02:00Z" },
        { id: "1", version_no: 1, name: "初始版本", reason: "initial", created_at: "2026-07-27T00:01:00Z" },
      ],
    });
  });

  it("只在后端确认后移除指定历史版本", async () => {
    vi.spyOn(api, "deleteVersion").mockResolvedValue({ deleted: true });

    await useResumeStore.getState().deleteVersion(1);

    expect(api.deleteVersion).toHaveBeenCalledWith("1", 1);
    expect(useResumeStore.getState().versions.map((version) => version.version_no)).toEqual([3, 2]);
    expect(useResumeStore.getState().versionOperationPending).toBe(false);
  });

  it("删除失败时保留版本列表", async () => {
    vi.spyOn(api, "deleteVersion").mockRejectedValue(new Error("HTTP_500"));

    await expect(useResumeStore.getState().deleteVersion(1)).rejects.toThrow("HTTP_500");

    expect(useResumeStore.getState().versions.map((version) => version.version_no)).toEqual([3, 2, 1]);
    expect(useResumeStore.getState().versionOperationPending).toBe(false);
  });
});

describe("resume version rename", () => {
  it("更新指定版本名称并保留其他版本", async () => {
    useResumeStore.setState({
      activeResumeId: "1",
      versions: [
        { id: "2", version_no: 2, name: "旧名称", reason: "manual", created_at: "2026-07-27T00:02:00Z" },
        { id: "1", version_no: 1, name: "初始版本", reason: "initial", created_at: "2026-07-27T00:01:00Z" },
      ],
    });
    const renamed = {
      id: "2",
      version_no: 2,
      name: "投递终版",
      reason: "manual" as const,
      created_at: "2026-07-27T00:02:00Z",
    };
    vi.spyOn(api, "renameVersion").mockResolvedValue({ version: renamed });

    await useResumeStore.getState().renameVersion(2, "投递终版");

    expect(api.renameVersion).toHaveBeenCalledWith("1", 2, "投递终版");
    expect(useResumeStore.getState().versions).toEqual([
      renamed,
      { id: "1", version_no: 1, name: "初始版本", reason: "initial", created_at: "2026-07-27T00:01:00Z" },
    ]);
  });
});

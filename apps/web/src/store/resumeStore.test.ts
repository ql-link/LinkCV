import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ResumeRecord } from "../api/client";
import {
  defaultSemanticDocument,
  defaultSemanticStyle,
  resumeDocumentFromMarkdown,
} from "../api/resumeContract";
import { defaultSettings, useResumeStore } from "./resumeStore";

function record(lockVersion: number, markdown: string, smartOnePage = false): ResumeRecord {
  return {
    id: "1",
    title: "测试简历",
    source_type: "blank",
    template_id: null,
    lock_version: lockVersion,
    data: resumeDocumentFromMarkdown(markdown, defaultSemanticDocument),
    style: { ...defaultSemanticStyle, smart_one_page: smartOnePage },
    source_filename: null,
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

beforeEach(() => {
  vi.restoreAllMocks();
  useResumeStore.setState({
    resumes: [],
    versions: [],
    versionsLoading: false,
    versionOperationPending: false,
    activeResumeId: "1",
    lockVersion: 1,
    data: defaultSemanticDocument,
    style: defaultSemanticStyle,
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
      markdown: "# 第二次编辑",
      dirty: false,
      saveStatus: "saved",
      error: null,
    });
  });

  it("saves a dirty draft before restoring a historical version", async () => {
    const calls: string[] = [];
    vi.spyOn(api, "updateResume").mockImplementation(async () => {
      calls.push("save");
      return { resume: record(2, "# 第一次编辑") };
    });
    vi.spyOn(api, "restoreVersion").mockImplementation(async () => {
      calls.push("restore");
      return { resume: record(3, "# 历史版本", true) };
    });
    vi.spyOn(api, "listVersions").mockResolvedValue({ versions: [] });

    await useResumeStore.getState().restoreVersion(1);

    expect(calls).toEqual(["save", "restore"]);
    expect(useResumeStore.getState()).toMatchObject({
      lockVersion: 3,
      markdown: "# 历史版本",
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

describe("resume version deletion", () => {
  beforeEach(() => {
    useResumeStore.setState({
      versions: [
        { id: "3", version_no: 3, reason: "manual", created_at: "2026-07-27T00:03:00Z" },
        { id: "2", version_no: 2, reason: "manual", created_at: "2026-07-27T00:02:00Z" },
        { id: "1", version_no: 1, reason: "initial", created_at: "2026-07-27T00:01:00Z" },
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

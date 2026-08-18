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
    importWarningsByResumeId: {},
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

    const result = await useResumeStore.getState().importResume(file, "8");

    expect(api.importResume).toHaveBeenCalledWith(
      file,
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

  it("changePassword 成功后调用接口并清空登录态", async () => {
    useResumeStore.setState({
      authStatus: "authenticated",
      user: { id: "1", email: "user@example.test", nickname: "昵称", is_admin: false },
      resumes: [
        {
          id: "1",
          title: "测试简历",
          source_type: "blank",
          lock_version: 1,
          created_at: "2026-07-27T00:00:00Z",
          updated_at: "2026-07-27T00:00:00Z",
        },
      ],
      dirty: true,
      saveStatus: "saving",
    });
    const change = vi
      .spyOn(api, "changePassword")
      .mockResolvedValue({ ok: true, message: "密码已修改，请重新登录" });
    const payload = {
      currentPassword: "password-123",
      newPassword: "new-password-456",
      confirmPassword: "new-password-456",
    };
    await useResumeStore.getState().changePassword(payload);
    expect(change).toHaveBeenCalledWith(payload);
    expect(useResumeStore.getState()).toMatchObject({
      authStatus: "guest",
      user: null,
      resumes: [],
      versions: [],
      activeResumeId: null,
      lockVersion: 0,
      dirty: false,
      saveStatus: "idle",
    });
  });

  it("changePassword 失败时保留登录态", async () => {
    useResumeStore.setState({
      authStatus: "authenticated",
      user: { id: "1", email: "user@example.test", nickname: "昵称", is_admin: false },
    });
    vi.spyOn(api, "changePassword").mockRejectedValue(
      new Error("INVALID_CURRENT_PASSWORD"),
    );
    await expect(
      useResumeStore.getState().changePassword({
        currentPassword: "wrong",
        newPassword: "new-password-456",
        confirmPassword: "new-password-456",
      }),
    ).rejects.toThrow();
    expect(useResumeStore.getState()).toMatchObject({
      authStatus: "authenticated",
    });
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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, type ApplicationData, type UserProfileData } from "@/api/client";
import { ApplicationProfileDialog, emptyApplicationData, mergeImport, validateApplicationDraft } from "./ApplicationProfileDialog";
import { setLocale, t } from "@/i18n";

afterEach(() => { vi.restoreAllMocks(); setLocale("zh-CN"); });
const profile: UserProfileData = { candidate_cities: ["杭州"], salary_min: null, salary_max: null, salary_currency: null, salary_period: null, employment_types: [], school: null, school_tier: [], major: null, education_level: null, candidate_status: null, graduation_year: null, years_experience: null, languages: [], skills: ["Java"], certifications: [], honors: [], campus_experiences: [], lock_version: 4, created_at: null, updated_at: null };
const resumes = [{ id: "1", title: "张三的示例简历" }] as Awaited<ReturnType<typeof api.listResumes>>["resumes"];
const imported: ApplicationData = { ...emptyApplicationData(), resume_ids: ["1"], basics: { name: "张三" }, records: [{ id: "education_source", group: "education", fields: { school: "示例大学" }, source: { resume_id: "1", index: 0, fingerprint: "a".repeat(64) } }] };

function mount(serverData: UserProfileData = profile) {
  vi.spyOn(api, "listResumes").mockResolvedValue({ resumes });
  const onSaved = vi.fn(), onConflict = vi.fn();
  render(<ApplicationProfileDialog serverData={serverData} onClose={vi.fn()} onSaved={onSaved} onConflict={onConflict} />);
  return { onSaved, onConflict };
}
async function previewImport() {
  await screen.findByRole("option", { name: resumes[0].title });
  fireEvent.change(screen.getByRole("combobox", { name: "导入来源简历" }), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "预览导入" }));
  await screen.findByRole("dialog", { name: "确认导入网申资料" });
}

describe("网申资料确认与保存", () => {
  it("保存前提示非法日历日期和不合理的绩点，避免模糊的整表失败", () => {
    expect(validateApplicationDraft({ ...emptyApplicationData(), basics: { birthDate: "2024-02-31" } })).toContain("出生日期");
    const data = structuredClone(imported);
    data.records[0].fields = { school: "示例大学", gpa: "4.2", gpaScale: "4" };
    expect(validateApplicationDraft(data)).toContain("不能超过满分");
    data.records[0].fields.gpa = "3.8";
    expect(validateApplicationDraft(data)).toBeNull();
  });
  it("界面随语言切换，已有中文事实保持原值", async () => {
    setLocale("en-US");
    const data = { ...emptyApplicationData(), basics: { gender: "女", name: "张三" } };
    mount({ ...profile, application_data: data });
    expect(screen.getByRole("dialog", { name: t("编辑网申资料") })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: t("姓名") })).toHaveValue("张三");
    expect(screen.getByRole("combobox", { name: t("性别") })).toHaveValue("女");
    expect(screen.getByRole("button", { name: t("预览导入") })).toBeInTheDocument();
  });
  it("重新导入按唯一内容对应，来源改变不会把旧绩点带到另一所学校", () => {
    const old = structuredClone(imported);
    old.records[0].fields.gpa = "3.8";
    const reordered = structuredClone(imported);
    reordered.records[0].source!.index = 1;
    expect(mergeImport(old, reordered).records[0]).toMatchObject({ fields: { gpa: "3.8" }, source: { index: 1 } });
    const changed = structuredClone(imported);
    changed.records[0].source!.fingerprint = "b".repeat(64);
    changed.records[0].fields.school = "另一所示例大学";
    const result = mergeImport(old, changed);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({ fields: { school: "示例大学", gpa: "3.8" }, source: null });
    expect(result.records[1].fields).toEqual({ school: "另一所示例大学" });
    expect(new Set(result.records.map((record) => record.id)).size).toBe(2);
  });
  it("预览和取消不写入，确认只加入草稿，保存保留求职偏好且不补默认事实", async () => {
    vi.spyOn(api, "previewApplicationImport").mockResolvedValue({ resume_id: "1", resume_lock_version: 2, title: resumes[0].title, application_data: imported, warnings: [] });
    const put = vi.spyOn(api, "putUserProfile").mockImplementation(async payload => ({ ...profile, ...payload, lock_version: 5 }));
    mount();
    expect(screen.getByRole("combobox", { name: "性别" })).toHaveValue("");
    await previewImport();
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消导入" }));
    expect(screen.getByRole("textbox", { name: "姓名" })).toHaveValue("");
    await previewImport();
    fireEvent.click(screen.getByRole("button", { name: "确认加入草稿" }));
    expect(screen.getByRole("textbox", { name: "姓名" })).toHaveValue("张三");
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存网申资料" }));
    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(put.mock.calls[0][0]).toMatchObject({ base_lock_version: 4, skills: ["Java"], candidate_cities: ["杭州"], application_data: imported });
    expect(put.mock.calls[0][0].application_data?.basics).not.toHaveProperty("gender");
  });

  it("重复导入同一条目保留额外资料，不重复添加；学习形式和培养方式分别编辑", async () => {
    const existing = structuredClone(imported);
    existing.records[0].fields = { school: "示例大学", gpa: "3.8", studyMode: "全日制", trainingMode: "统招" };
    vi.spyOn(api, "previewApplicationImport").mockResolvedValue({ resume_id: "1", resume_lock_version: 2, title: resumes[0].title, application_data: imported, warnings: [] });
    const put = vi.spyOn(api, "putUserProfile").mockResolvedValue(profile);
    mount({ ...profile, application_data: existing });
    await previewImport();
    fireEvent.click(screen.getByRole("button", { name: "确认加入草稿" }));
    fireEvent.click(screen.getByRole("tab", { name: "教育经历 (1)" }));
    expect(screen.getByRole("combobox", { name: "education 1 学习形式" })).toHaveValue("全日制");
    expect(screen.getByRole("combobox", { name: "education 1 培养方式" })).toHaveValue("统招");
    fireEvent.click(screen.getByRole("button", { name: "保存网申资料" }));
    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(put.mock.calls[0][0].application_data?.records).toEqual(existing.records);
  });

  it("版本冲突读取最新资料后等待用户重新确认，不自动覆盖", async () => {
    const latest = { ...profile, lock_version: 8, application_data: { ...emptyApplicationData(), basics: { name: "张三" } } };
    const put = vi.spyOn(api, "putUserProfile").mockRejectedValue(new ApiRequestError(409, "USER_PROFILE_VERSION_CONFLICT", { profile: latest }));
    const { onConflict, onSaved } = mount();
    fireEvent.change(screen.getByRole("textbox", { name: "姓名" }), { target: { value: "旧草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存网申资料" }));
    await screen.findByText(/资料已在其他页面修改/);
    expect(screen.getByRole("textbox", { name: "姓名" })).toHaveValue("张三");
    expect(onConflict).toHaveBeenCalledWith(latest);
    expect(onSaved).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledOnce();
  });
});

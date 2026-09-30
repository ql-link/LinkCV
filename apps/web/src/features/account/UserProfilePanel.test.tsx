import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiRequestError, type UserProfileData } from "../../api/client";
import { UserProfilePanel } from "./UserProfilePanel";

const emptyProfile: UserProfileData = {
  candidate_cities: [],
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  employment_types: [],
  school: null,
  school_tier: [],
  major: null,
  education_level: null,
  candidate_status: null,
  graduation_year: null,
  years_experience: null,
  languages: [],
  skills: [],
  certifications: [],
  honors: [],
  campus_experiences: [],
  lock_version: 1,
  created_at: null,
  updated_at: null,
};

const mockProfile: UserProfileData = {
  ...emptyProfile,
  candidate_cities: ["杭州", "上海", "深圳", "成都"],
  salary_min: 15000,
  salary_max: 25000,
  salary_currency: "CNY",
  salary_period: "month",
  employment_types: ["full_time", "internship"],
  school: "浙江大学",
  school_tier: ["project_985", "project_211"],
  major: "软件工程",
  education_level: "master",
  candidate_status: "experienced",
  years_experience: 5,
  languages: ["英语 CET-6"],
  skills: ["React", "TypeScript", "Node.js"],
  certifications: ["AWS Certified Developer"],
  honors: ["优秀毕业生"],
  campus_experiences: ["学生会主席"],
  lock_version: 2,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-15T00:00:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

async function openEditor() {
  const row = await screen.findByRole("button", { name: "个人画像" });
  await waitFor(() => expect(row).not.toBeDisabled());
  fireEvent.click(row);
  return screen.findByRole("dialog", { name: "编辑个人画像" });
}

describe("UserProfilePanel", () => {
  it("账号页只显示填写进度，不展示画像内容", async () => {
    const getSpy = vi.spyOn(api, "getUserProfile").mockResolvedValue(mockProfile);

    render(<UserProfilePanel />);

    expect(await screen.findByText(/已填 \d+ \/ 14 项/)).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledOnce();
    expect(screen.getByText("城市、薪资、学历等 · 所有简历共用")).toBeInTheDocument();
    expect(screen.queryByText("杭州")).not.toBeInTheDocument();
    expect(screen.queryByText("去填写")).not.toBeInTheDocument();
  });

  it("还没有填写时右侧显示「去填写」，技能里的「无」不计入进度", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue({ ...emptyProfile, skills: ["无"], honors: [" 无 "] });

    render(<UserProfilePanel />);

    expect(await screen.findByText("去填写")).toBeInTheDocument();
  });

  it("加载失败时入口置灰并提示不可用", async () => {
    vi.spyOn(api, "getUserProfile").mockRejectedValue(new ApiRequestError(503, "SERVICE_UNAVAILABLE"));

    render(<UserProfilePanel />);

    expect(await screen.findByText("个人画像暂不可用，请稍后重试。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "个人画像" })).toBeDisabled();
  });

  it("可接受城市支持逗号批量添加，工作性质可多选", async () => {
    const putSpy = vi.spyOn(api, "putUserProfile").mockResolvedValue({
      ...emptyProfile,
      candidate_cities: ["深圳", "苏州"],
      employment_types: ["full_time", "internship"],
      lock_version: 2,
    });
    vi.spyOn(api, "getUserProfile").mockResolvedValue(emptyProfile);

    render(<UserProfilePanel />);
    await openEditor();

    const cityInput = screen.getByRole("textbox", { name: "可接受工作城市" });
    fireEvent.change(cityInput, { target: { value: "深圳，苏州" } });
    fireEvent.keyDown(cityInput, { key: "Enter" });
    expect(screen.getByLabelText("移除 深圳")).toBeInTheDocument();
    expect(screen.getByLabelText("移除 苏州")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "全职" }));
    fireEvent.click(screen.getByRole("button", { name: "实习" }));
    expect(screen.getByRole("button", { name: "全职" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "实习" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledOnce());
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_cities: ["深圳", "苏州"],
        employment_types: ["full_time", "internship"],
        base_lock_version: 1,
      }),
    );
    expect(await screen.findByText("个人画像已保存。")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "编辑个人画像" })).not.toBeInTheDocument();
  });

  it("可接受城市最多 20 个", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue(emptyProfile);
    render(<UserProfilePanel />);
    await openEditor();

    const cityInput = screen.getByRole("textbox", { name: "可接受工作城市" });
    fireEvent.change(cityInput, { target: { value: Array.from({ length: 25 }, (_, i) => `城市${i}`).join(",") } });
    fireEvent.keyDown(cityInput, { key: "Enter" });

    expect(screen.getAllByRole("button", { name: /^移除 城市/ })).toHaveLength(20);
    expect(cityInput).toBeDisabled();
  });

  it("应届生只显示毕业年份并固定发送工作年限 0", async () => {
    const putSpy = vi.spyOn(api, "putUserProfile").mockResolvedValue({
      ...emptyProfile,
      candidate_status: "fresh_graduate",
      graduation_year: 2026,
      years_experience: 0,
      lock_version: 2,
    });
    vi.spyOn(api, "getUserProfile").mockResolvedValue(emptyProfile);

    render(<UserProfilePanel />);
    await openEditor();
    expect(screen.queryByRole("spinbutton", { name: "毕业年份" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "工作年限" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应届生" }));

    expect(screen.getByRole("spinbutton", { name: "毕业年份" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "工作年限" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "毕业年份" }), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledOnce());
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({ candidate_status: "fresh_graduate", graduation_year: 2026, years_experience: 0, base_lock_version: 1 }),
    );
  });

  it("应届生没填毕业年份时拦截保存", async () => {
    const putSpy = vi.spyOn(api, "putUserProfile");
    vi.spyOn(api, "getUserProfile").mockResolvedValue(emptyProfile);

    render(<UserProfilePanel />);
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "应届生" }));
    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));

    expect(await screen.findByText("应届生请填写 1900–9999 之间的四位毕业年份。")).toBeInTheDocument();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("非应届生只显示工作年限并清空毕业年份", async () => {
    const experiencedProfile: UserProfileData = { ...emptyProfile, candidate_status: "experienced", graduation_year: null, years_experience: null };
    const putSpy = vi.spyOn(api, "putUserProfile").mockResolvedValue({ ...experiencedProfile, years_experience: 3, lock_version: 2 });
    vi.spyOn(api, "getUserProfile").mockResolvedValue(experiencedProfile);

    render(<UserProfilePanel />);
    await openEditor();
    expect(screen.getByRole("button", { name: "非应届生" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("spinbutton", { name: "毕业年份" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "工作年限" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledOnce());
    expect(putSpy).toHaveBeenCalledWith(expect.objectContaining({ candidate_status: "experienced", graduation_year: null, years_experience: 3 }));
  });

  it("学校标签在学历与院校分类里支持多选", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue(emptyProfile);

    render(<UserProfilePanel />);
    await openEditor();
    fireEvent.click(screen.getByRole("tab", { name: /学历与院校/ }));

    const tier985 = screen.getByRole("button", { name: "985 院校" });
    const tier211 = screen.getByRole("button", { name: "211 院校" });
    fireEvent.click(tier985);
    fireEvent.click(tier211);
    expect(tier985).toHaveAttribute("aria-pressed", "true");
    expect(tier211).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tab", { name: /学历与院校/ })).toHaveTextContent("差 3 项");
  });

  it("中文输入法确认候选词时不会提前添加技能标签", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue(emptyProfile);

    render(<UserProfilePanel />);
    await openEditor();
    fireEvent.click(screen.getByRole("tab", { name: /技能与证书/ }));

    const input = screen.getByRole("textbox", { name: "专业技能" });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "python" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 229 });

    expect(input).toHaveValue("python");
    expect(screen.queryByRole("button", { name: "移除 python" })).not.toBeInTheDocument();

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "移除 python" })).toBeInTheDocument();
  });

  it("未选择工作经验时不显示条件输入且保存保留历史经验", async () => {
    const profileWithHistory: UserProfileData = { ...emptyProfile, years_experience: 2 };
    const putSpy = vi.spyOn(api, "putUserProfile").mockResolvedValue({ ...profileWithHistory, lock_version: 2 });
    vi.spyOn(api, "getUserProfile").mockResolvedValue(profileWithHistory);

    render(<UserProfilePanel />);
    await openEditor();
    expect(screen.queryByRole("spinbutton", { name: "工作年限" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledOnce());
    expect(putSpy).toHaveBeenCalledWith(expect.objectContaining({ candidate_status: null, graduation_year: null, years_experience: 2 }));
  });

  it("保存薪资时补齐币种和计薪周期，字符串小数也能正确回填", async () => {
    const putSpy = vi.spyOn(api, "putUserProfile").mockResolvedValue({ ...mockProfile, lock_version: 3 });
    vi.spyOn(api, "getUserProfile").mockResolvedValue({
      ...mockProfile,
      salary_min: "15000.00" as unknown as number,
      salary_max: "25000.00" as unknown as number,
    });

    render(<UserProfilePanel />);
    await openEditor();
    const minimumSalary = screen.getByRole("spinbutton", { name: "最低薪资" });
    expect(minimumSalary).toHaveAttribute("step", "1000");
    expect(minimumSalary).toHaveValue(15000);
    fireEvent.change(minimumSalary, { target: { value: "18000" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "最高薪资" }), { target: { value: "30000" } });
    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledOnce());
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({ salary_min: 18000, salary_max: 30000, salary_currency: "CNY", salary_period: "month", base_lock_version: 2 }),
    );
  });

  it("最高薪资低于最低薪资时拦截保存", async () => {
    const putSpy = vi.spyOn(api, "putUserProfile");
    vi.spyOn(api, "getUserProfile").mockResolvedValue(emptyProfile);

    render(<UserProfilePanel />);
    await openEditor();
    fireEvent.change(screen.getByRole("spinbutton", { name: "最低薪资" }), { target: { value: "30000" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "最高薪资" }), { target: { value: "20000" } });
    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));

    expect(await screen.findByText("最高薪资不能低于最低薪资。")).toBeInTheDocument();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("保存发生 409 冲突时刷新最新画像并提示，不自动重放", async () => {
    const latestProfile: UserProfileData = { ...mockProfile, candidate_cities: ["深圳"], lock_version: 4 };
    const putSpy = vi.spyOn(api, "putUserProfile").mockRejectedValue(
      new ApiRequestError(409, "USER_PROFILE_VERSION_CONFLICT", { profile: latestProfile }),
    );
    vi.spyOn(api, "getUserProfile").mockResolvedValue(mockProfile);

    render(<UserProfilePanel />);
    await openEditor();
    expect(screen.getByLabelText("移除 杭州")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("数据已被其他写入方修改，已刷新为最新版本，请确认后重试。");
    expect(screen.getByLabelText("移除 深圳")).toBeInTheDocument();
    expect(screen.queryByLabelText("移除 杭州")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "编辑个人画像" })).toBeInTheDocument();
    expect(putSpy).toHaveBeenCalledOnce();
  });
});

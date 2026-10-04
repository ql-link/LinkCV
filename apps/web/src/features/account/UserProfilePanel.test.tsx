import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiRequestError, type UserProfileData } from "../../api/client";
import { UserProfilePanel } from "./UserProfilePanel";
import { setLocale } from "../../i18n";

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
  setLocale("zh-CN");
  vi.restoreAllMocks();
});

async function openEditor() {
  const row = await screen.findByRole("button", { name: "个人画像详情" });
  await waitFor(() => expect(row).not.toBeDisabled());
  fireEvent.click(row);
  return screen.findByRole("dialog", { name: "编辑个人画像" });
}

function chooseCandidateStatus(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "工作经验" }));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("UserProfilePanel", () => {
  it("账号页显示画像摘要，通过详情进入原编辑弹窗", async () => {
    const getSpy = vi.spyOn(api, "getUserProfile").mockResolvedValue(mockProfile);

    render(<UserProfilePanel />);

    expect(await screen.findByText(/已填 \d+ \/ 14 项/)).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledOnce();
    const summary = screen.getByLabelText("个人画像摘要");
    expect(within(summary).getByText("杭州、上海、深圳、成都")).toBeInTheDocument();
    expect(within(summary).getByText("CNY 15,000–25,000 · 月薪")).toBeInTheDocument();
    expect(within(summary).getByText("5 年工作经验")).toBeInTheDocument();
    expect(within(summary).getByText("硕士 · 浙江大学 · 软件工程")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("React")).not.toBeInTheDocument();
    await openEditor();
  });

  it("空画像显示未填写和零进度，仍可从详情填写", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue({ ...emptyProfile, skills: ["无"], honors: [" 无 "] });

    render(<UserProfilePanel />);

    expect(await screen.findByText("已填 0 / 14 项")).toBeInTheDocument();
    expect(within(screen.getByLabelText("个人画像摘要")).getAllByText("未填写")).toHaveLength(4);
    await openEditor();
  });

  it("加载失败后可从入口重试，恢复后能打开编辑弹窗", async () => {
    const getProfile = vi.spyOn(api, "getUserProfile")
      .mockRejectedValueOnce(new ApiRequestError(503, "SERVICE_UNAVAILABLE"))
      .mockResolvedValueOnce(mockProfile);

    render(<UserProfilePanel />);

    expect(await screen.findByText("读取失败，点击重试")).toBeInTheDocument();
    const entry = screen.getByRole("button", { name: "重新读取个人画像" });
    expect(entry).not.toBeDisabled();
    fireEvent.click(entry);
    expect(await screen.findByText(/已填 \d+ \/ 14 项/)).toBeInTheDocument();
    expect(getProfile).toHaveBeenCalledTimes(2);
    await openEditor();
  });

  it("摘要保留零值，并展示原币种和计薪周期", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue({ ...mockProfile, salary_min: 0, salary_max: 0, salary_currency: "USD", salary_period: "hour", years_experience: 0 });
    render(<UserProfilePanel />);
    const summary = await screen.findByLabelText("个人画像摘要");
    expect(within(summary).getByText("USD 0 · 时薪")).toBeInTheDocument();
    expect(within(summary).getByText("0 年工作经验")).toBeInTheDocument();
  });

  it("摘要显示单侧薪资和应届毕业年份，中英文切换保留用户内容", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue({ ...mockProfile, salary_min: null, salary_max: 30000, candidate_status: "fresh_graduate", graduation_year: 2027, years_experience: 0 });
    setLocale("en-US");
    render(<UserProfilePanel />);
    const summary = await screen.findByLabelText("Career profile summary");
    expect(within(summary).getByText("CNY ≤ 30,000 · Monthly")).toBeInTheDocument();
    expect(within(summary).getByText("New graduate · class of 2027")).toBeInTheDocument();
    expect(within(summary).getByText("杭州, 上海, 深圳, 成都")).toBeInTheDocument();
    expect(within(summary).getByText(/浙江大学 · 软件工程/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Career profile details" })).not.toBeDisabled();
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

    fireEvent.click(screen.getByRole("combobox", { name: "工作性质" }));
    const list = screen.getByRole("listbox", { name: "工作性质" });
    expect(list).toHaveAttribute("aria-multiselectable", "true");
    fireEvent.click(within(list).getByRole("option", { name: "全职" }));
    fireEvent.click(within(list).getByRole("option", { name: "实习" }));
    expect(within(list).getByRole("option", { name: "全职" })).toHaveAttribute("aria-selected", "true");
    expect(within(list).getByRole("option", { name: "实习" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "工作性质" }), { key: "Escape" });
    expect(screen.getByRole("combobox", { name: "工作性质" })).toHaveTextContent("实习全职");

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
    expect(within(screen.getByLabelText("个人画像摘要")).getByText("深圳、苏州")).toBeInTheDocument();
  });

  it("工作性质支持键盘多选、取消选择和 Escape 只关闭下拉", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue(emptyProfile);
    render(<UserProfilePanel />);
    await openEditor();
    const trigger = screen.getByRole("combobox", { name: "工作性质" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: " " });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("option", { name: "实习" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "全职" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(trigger, { key: "Home" });
    fireEvent.keyDown(trigger, { key: " " });
    expect(screen.getByRole("option", { name: "实习" })).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "工作性质" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "编辑个人画像" })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent("全职");
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "全职" })).toHaveAttribute("aria-selected", "true");
    fireEvent.pointerDown(screen.getByRole("heading", { name: "求职条件" }));
    expect(screen.queryByRole("listbox", { name: "工作性质" })).not.toBeInTheDocument();
  });

  it("多选工作性质在英文编辑弹窗回填，两项可全部取消", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue(mockProfile);
    setLocale("en-US");
    render(<UserProfilePanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Career profile details" }));
    const trigger = await screen.findByRole("combobox", { name: "Employment type" });
    expect(trigger).toHaveTextContent("InternshipFull-time");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Internship" }));
    fireEvent.click(screen.getByRole("option", { name: "Full-time" }));
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveTextContent("Select employment types");
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
    chooseCandidateStatus("应届生");

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
    chooseCandidateStatus("应届生");
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
    expect(screen.getByRole("button", { name: "工作经验" })).toHaveTextContent("非应届生");
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

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

function openEditor() {
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  return screen.findByRole("dialog", { name: "编辑个人画像" });
}

describe("UserProfilePanel", () => {
  it("独立读取画像并展示三组新字段", async () => {
    const getSpy = vi.spyOn(api, "getUserProfile").mockResolvedValue(mockProfile);

    render(<UserProfilePanel />);

    expect(await screen.findByText("杭州、上海、深圳")).toBeInTheDocument();
    expect(screen.queryByText("成都")).not.toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledOnce();
    expect(screen.getByText("15k - 25k / 月")).toBeInTheDocument();
    expect(screen.getByText("全职 · 实习")).toBeInTheDocument();
    expect(screen.getByText("5 年经验")).toBeInTheDocument();
    expect(screen.queryByText(/非应届生 ·/)).not.toBeInTheDocument();
    expect(screen.getByText("学历与院校")).toBeInTheDocument();
    expect(screen.getByText("硕士 · 浙江大学")).toBeInTheDocument();
    expect(screen.getByText("专业方向")).toBeInTheDocument();
    expect(screen.getByText("软件工程")).toBeInTheDocument();
    expect(screen.queryByText("学校标签")).not.toBeInTheDocument();
    expect(screen.queryByText("985 院校")).not.toBeInTheDocument();
    expect(screen.getByText("React、TypeScript、Node.js")).toBeInTheDocument();
    const skillsGrid = document.querySelector(".account-profile-display-meta-grid-skills");
    expect(skillsGrid).toBeInTheDocument();
    expect(skillsGrid?.querySelectorAll(".account-profile-display-meta-item")).toHaveLength(5);
    expect(skillsGrid?.querySelector(".account-profile-display-meta-item-span2")).toBeNull();
    expect(screen.queryByText("职业方向")).not.toBeInTheDocument();
    expect(screen.queryByText("目标公司")).not.toBeInTheDocument();
    expect(screen.queryByText("出生日期")).not.toBeInTheDocument();
  });

  it("技能成果中的无不参与概览展示", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue({
      ...emptyProfile,
      skills: ["无"],
      languages: ["英语六级", "无"],
      certifications: ["无"],
      honors: [" 无 "],
      campus_experiences: ["无"],
    });

    render(<UserProfilePanel />);

    expect(await screen.findByText("英语六级")).toBeInTheDocument();
    expect(screen.getByText("语言能力")).toBeInTheDocument();
    expect(screen.queryByText("专业技能")).not.toBeInTheDocument();
    expect(screen.queryByText("专业证书")).not.toBeInTheDocument();
    expect(screen.queryByText("荣誉奖项")).not.toBeInTheDocument();
    expect(screen.queryByText("校园经历")).not.toBeInTheDocument();
    expect(screen.queryByText("无")).not.toBeInTheDocument();
  });

  it("加载失败时保留画像卡片失败状态", async () => {
    vi.spyOn(api, "getUserProfile").mockRejectedValue(
      new ApiRequestError(503, "SERVICE_UNAVAILABLE"),
    );

    render(<UserProfilePanel />);

    expect(await screen.findByText("个人画像暂不可用，请稍后重试。"))
      .toBeInTheDocument();
  });

  it("支持城市预设、自定义以及两种工作性质多选", async () => {
    const putSpy = vi.spyOn(api, "putUserProfile").mockResolvedValue({
      ...emptyProfile,
      candidate_cities: ["深圳", "苏州"],
      employment_types: ["full_time", "internship"],
      lock_version: 2,
    });
    vi.spyOn(api, "getUserProfile").mockResolvedValue(emptyProfile);

    render(<UserProfilePanel />);
    await screen.findByText("暂未完善个人画像");
    await openEditor();

    const cityInput = screen.getByRole("textbox", { name: "如：北京、上海、杭州" });
    expect(screen.queryByText("常用")).not.toBeInTheDocument();
    fireEvent.change(cityInput, { target: { value: "深圳，苏州" } });
    fireEvent.keyDown(cityInput, { key: "Enter" });
    expect(screen.getByLabelText("移除 深圳")).toBeInTheDocument();
    expect(screen.getByLabelText("移除 苏州")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "全职" }));
    fireEvent.click(screen.getByRole("button", { name: "实习" }));
    expect(screen.getByRole("button", { name: "全职" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "实习" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledOnce());
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_cities: ["深圳", "苏州"],
        employment_types: ["full_time", "internship"],
        base_lock_version: 1,
      }),
    );
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
    await screen.findByText("暂未完善个人画像");
    await openEditor();
    expect(screen.queryByText("不填写则不参与薪资筛选")).not.toBeInTheDocument();
    expect(screen.queryByText("未选择")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "毕业年份" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "工作年限" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "工作经验" }));
    fireEvent.click(await screen.findByRole("option", { name: "应届生" }));

    expect(screen.getByRole("spinbutton", { name: "毕业年份" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "工作年限" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "毕业年份增加" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "毕业年份减少" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "毕业年份增加" }));
    expect(screen.getByRole("spinbutton", { name: "毕业年份" })).toHaveValue(1900);
    fireEvent.change(screen.getByRole("spinbutton", { name: "毕业年份" }), {
      target: { value: "2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledOnce());
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_status: "fresh_graduate",
        graduation_year: 2026,
        years_experience: 0,
        base_lock_version: 1,
      }),
    );
  });

  it("非应届生只显示工作年限并清空毕业年份", async () => {
    const experiencedProfile: UserProfileData = {
      ...emptyProfile,
      candidate_status: "experienced",
      graduation_year: null,
      years_experience: null,
    };
    const putSpy = vi.spyOn(api, "putUserProfile").mockResolvedValue({
      ...experiencedProfile,
      years_experience: 3,
      lock_version: 2,
    });
    vi.spyOn(api, "getUserProfile").mockResolvedValue(experiencedProfile);

    render(<UserProfilePanel />);
    await screen.findByRole("heading", { name: "个人画像" });
    await openEditor();
    expect(screen.getByRole("combobox", { name: "工作经验" })).toHaveTextContent(
      "非应届生",
    );
    expect(screen.getByRole("spinbutton", { name: "工作年限" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "毕业年份" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "工作年限" }), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledOnce());
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_status: "experienced",
        graduation_year: null,
        years_experience: 3,
      }),
    );
  });

  it("学校标签在教育页支持三个等宽多选项", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue(emptyProfile);

    render(<UserProfilePanel />);
    await screen.findByText("暂未完善个人画像");
    await openEditor();
    fireEvent.click(screen.getByRole("tab", { name: "教育与背景" }));

    const tier985 = screen.getByRole("button", { name: "985 院校" });
    const tier211 = screen.getByRole("button", { name: "211 院校" });
    expect(screen.getByText("可多选")).toBeInTheDocument();
    fireEvent.click(tier985);
    fireEvent.click(tier211);
    expect(tier985).toHaveAttribute("aria-pressed", "true");
    expect(tier211).toHaveAttribute("aria-pressed", "true");
  });

  it("中文输入法确认候选词时不会提前添加技能标签", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue(emptyProfile);

    render(<UserProfilePanel />);
    await screen.findByText("暂未完善个人画像");
    await openEditor();
    fireEvent.click(screen.getByRole("tab", { name: "技能与亮点" }));

    const input = screen.getByRole("textbox", {
      name: "如：React、TypeScript、FastAPI、MySQL、Docker",
    });
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
    const profileWithHistory: UserProfileData = {
      ...emptyProfile,
      years_experience: 2,
    };
    const putSpy = vi.spyOn(api, "putUserProfile").mockResolvedValue({
      ...profileWithHistory,
      lock_version: 2,
    });
    vi.spyOn(api, "getUserProfile").mockResolvedValue(profileWithHistory);

    render(<UserProfilePanel />);
    await screen.findByText("2 年经验");
    await openEditor();
    expect(screen.queryByText("未选择")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "工作年限" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledOnce());
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_status: null,
        graduation_year: null,
        years_experience: 2,
      }),
    );
  });

  it("保存薪资四字段并在保存成功后更新展示", async () => {
    const putSpy = vi.spyOn(api, "putUserProfile").mockResolvedValue({
      ...emptyProfile,
      salary_min: 18000,
      salary_max: 30000,
      salary_currency: "CNY",
      salary_period: "month",
      lock_version: 2,
    });
    vi.spyOn(api, "getUserProfile").mockResolvedValue(emptyProfile);

    render(<UserProfilePanel />);
    await screen.findByText("暂未完善个人画像");
    await openEditor();
    fireEvent.change(screen.getByRole("spinbutton", { name: "最低薪资" }), {
      target: { value: "18000" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "最高薪资" }), {
      target: { value: "30000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledOnce());
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        salary_min: 18000,
        salary_max: 30000,
        salary_currency: "CNY",
        salary_period: "month",
      }),
    );
    expect(await screen.findByText("18k - 30k / 月")).toBeInTheDocument();
  });

  it("薪资箭头每次按一千调整", async () => {
    vi.spyOn(api, "getUserProfile").mockResolvedValue({
      ...mockProfile,
      salary_min: "15000.00" as unknown as number,
      salary_max: "25000.00" as unknown as number,
    });

    render(<UserProfilePanel />);
    await screen.findByText("15k - 25k / 月");
    await openEditor();

    const minimumSalary = screen.getByRole("spinbutton", { name: "最低薪资" });
    const maximumSalary = screen.getByRole("spinbutton", { name: "最高薪资" });
    expect(minimumSalary).toHaveAttribute("step", "1000");
    expect(maximumSalary).toHaveAttribute("step", "1000");
    expect((minimumSalary as HTMLInputElement).value).toBe("15000");
    expect((maximumSalary as HTMLInputElement).value).toBe("25000");

    fireEvent.click(screen.getByRole("button", { name: "最低薪资增加" }));
    expect(minimumSalary).toHaveValue(16000);
    fireEvent.click(screen.getByRole("button", { name: "最低薪资减少" }));
    expect(minimumSalary).toHaveValue(15000);
  });

  it("保存发生 409 冲突时刷新最新画像并提示，不自动重放", async () => {
    const latestProfile: UserProfileData = {
      ...mockProfile,
      candidate_cities: ["深圳"],
      lock_version: 4,
    };
    const putSpy = vi.spyOn(api, "putUserProfile").mockRejectedValue(
      new ApiRequestError(409, "USER_PROFILE_VERSION_CONFLICT", {
        profile: latestProfile,
      }),
    );
    vi.spyOn(api, "getUserProfile").mockResolvedValue(mockProfile);

    render(<UserProfilePanel />);
    await screen.findByText("杭州、上海、深圳");
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "保存画像" }));

    expect(
      await screen.findByText("数据已被其他写入方修改，已刷新为最新版本，请确认后重试。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("移除 深圳")).toBeInTheDocument();
    expect(putSpy).toHaveBeenCalledOnce();
  });
});

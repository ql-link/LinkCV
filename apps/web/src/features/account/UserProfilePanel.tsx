import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  Button,
  FeedbackNotice,
  Input,
  PageLoading,
  SelectField,
  TogglePill,
} from "@/components/ui";
import {
  api,
  ApiRequestError,
  type EmploymentType,
  type EducationLevel,
  type SalaryPeriod,
  type SchoolTier,
  type UserProfileData,
  type WorkMode,
} from "../../api/client";
import { accountErrorMessage } from "./AccountPage";

type Notice = { kind: "success" | "error"; message: string } | null;

type ProfileForm = Omit<
  UserProfileData,
  "lock_version" | "created_at" | "updated_at"
>;

const EMPLOYMENT_TYPE_OPTIONS: Array<{ label: string; value: EmploymentType }> = [
  { label: "全职", value: "full_time" },
  { label: "兼职", value: "part_time" },
  { label: "实习", value: "internship" },
  { label: "合同", value: "contract" },
  { label: "临时", value: "temporary" },
];

const WORK_MODE_OPTIONS: Array<{ label: string; value: WorkMode }> = [
  { label: "现场", value: "onsite" },
  { label: "混合", value: "hybrid" },
  { label: "远程", value: "remote" },
];

const SALARY_PERIOD_OPTIONS: Array<{ label: string; value: SalaryPeriod }> = [
  { label: "时薪", value: "hour" },
  { label: "日薪", value: "day" },
  { label: "月薪", value: "month" },
  { label: "年薪", value: "year" },
];

const AVAILABILITY_OPTIONS = [
  { label: "随时到岗", value: "immediately" },
  { label: "一周内", value: "one_week" },
  { label: "两周内", value: "two_weeks" },
  { label: "一月内", value: "one_month" },
  { label: "自定义日期", value: "custom" },
];

const EDUCATION_LEVEL_OPTIONS: Array<{ label: string; value: EducationLevel }> = [
  { label: "高中", value: "high_school" },
  { label: "大专", value: "junior_college" },
  { label: "本科", value: "bachelor" },
  { label: "硕士", value: "master" },
  { label: "博士", value: "doctor" },
];

const SCHOOL_TIER_OPTIONS: Array<{ label: string; value: SchoolTier }> = [
  { label: "985", value: "project_985" },
  { label: "211", value: "project_211" },
  { label: "双一流", value: "double_first_class" },
];

const EMPTY_FORM: ProfileForm = {
  work_city: null,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  employment_type: null,
  work_mode: null,
  target_positions: [],
  exclusions: [],
  target_companies: [],
  availability: null,
  available_from: null,
  school: null,
  school_tier: [],
  major: null,
  education_level: null,
  years_experience: null,
  birth_date: null,
  languages: [],
  skills: [],
  certifications: [],
  honors: [],
  campus_experiences: [],
};

function toFormState(data: UserProfileData | null | undefined): ProfileForm {
  if (!data) return { ...EMPTY_FORM };
  const { lock_version: _lock, created_at: _c, updated_at: _u, ...rest } = data;
  return {
    ...EMPTY_FORM,
    ...rest,
    target_positions: [...rest.target_positions],
    exclusions: [...rest.exclusions],
    target_companies: [...rest.target_companies],
    school_tier: [...rest.school_tier],
    languages: [...rest.languages],
    skills: [...rest.skills],
    certifications: [...rest.certifications],
    honors: [...rest.honors],
    campus_experiences: [...rest.campus_experiences],
  };
}

function nullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function dateToString(value: string | null): string {
  return value ?? "";
}

function stringToDate(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

type UserProfilePanelProps = {
  initialProfile?: UserProfileData | null;
};

export function UserProfilePanel({ initialProfile }: UserProfilePanelProps) {
  const [serverData, setServerData] = useState<UserProfileData | null>(
    initialProfile ?? null,
  );
  const [form, setForm] = useState<ProfileForm>(() => toFormState(initialProfile));
  const [loading, setLoading] = useState(!initialProfile);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [salaryEnabled, setSalaryEnabled] = useState(
    Boolean(
      initialProfile?.salary_min ??
        initialProfile?.salary_max ??
        initialProfile?.salary_currency ??
        initialProfile?.salary_period,
    ),
  );

  useEffect(() => {
    if (initialProfile) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.getUserProfile();
        if (cancelled) return;
        setServerData(result);
        setForm(toFormState(result));
        setSalaryEnabled(
          Boolean(
            result.salary_min ??
              result.salary_max ??
              result.salary_currency ??
              result.salary_period,
          ),
        );
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialProfile]);

  const update = <K extends keyof ProfileForm>(
    key: K,
    value: ProfileForm[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleSchoolTier = (value: SchoolTier) => {
    setForm((current) => ({
      ...current,
      school_tier: current.school_tier.includes(value)
        ? current.school_tier.filter((item) => item !== value)
        : [...current.school_tier, value],
    }));
  };

  const save = async () => {
    if (!serverData) return;
    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        ...form,
        salary_min: salaryEnabled ? form.salary_min : null,
        salary_max: salaryEnabled ? form.salary_max : null,
        salary_currency: salaryEnabled ? form.salary_currency : null,
        salary_period: salaryEnabled ? form.salary_period : null,
        available_from:
          form.availability === "custom" ? form.available_from : null,
        base_lock_version: serverData.lock_version,
      };
      const updated = await api.putUserProfile(payload);
      setServerData(updated);
      setForm(toFormState(updated));
      setSalaryEnabled(
        Boolean(
          updated.salary_min ??
            updated.salary_max ??
            updated.salary_currency ??
            updated.salary_period,
        ),
      );
      setNotice({ kind: "success", message: "个人画像已保存。" });
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.payload &&
        typeof error.payload === "object" &&
        "profile" in error.payload
      ) {
        const latest = (error.payload as { profile: UserProfileData }).profile;
        setServerData(latest);
        setForm(toFormState(latest));
        setSalaryEnabled(
          Boolean(
            latest.salary_min ??
              latest.salary_max ??
              latest.salary_currency ??
              latest.salary_period,
          ),
        );
        setNotice({
          kind: "error",
          message: "数据已被其他写入方修改，已刷新为最新版本，请确认后重试。",
        });
      } else {
        setNotice({
          kind: "error",
          message: accountErrorMessage(error, "画像保存失败，请稍后重试。"),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="account-profile-panel" aria-label="个人画像">
        <PageLoading label="正在加载个人画像…" />
      </section>
    );
  }

  if (failed) {
    return (
      <section className="account-profile-panel" aria-label="个人画像">
        <header className="account-profile-panel-header">
          <h2 id="account-profile-heading">个人画像</h2>
        </header>
        <p className="account-profile-panel-empty">个人画像暂不可用，请稍后重试。</p>
      </section>
    );
  }

  return (
    <section className="account-profile-panel" aria-label="个人画像">
      <header className="account-profile-panel-header">
        <h2 id="account-profile-heading">个人画像</h2>
        <p>跨简历共享的求职偏好与个人基础信息，不会修改简历内容。</p>
      </header>

      <div className="account-profile-panel-body">
        <fieldset className="account-profile-group">
          <legend>求职偏好</legend>
          <div className="account-profile-fields">
            <label className="account-profile-field">
              <span className="account-profile-field-label">期望工作地点</span>
              <Input
                aria-label="期望工作地点"
                value={form.work_city ?? ""}
                maxLength={100}
                onChange={(event) => update("work_city", event.target.value || null)}
              />
            </label>
            <label className="account-profile-field">
              <span className="account-profile-field-label">工作性质</span>
              <SelectField
                label="工作性质"
                value={form.employment_type ?? ""}
                options={EMPLOYMENT_TYPE_OPTIONS}
                onChange={(event) =>
                  update("employment_type", (event.target.value || null) as EmploymentType | null)
                }
              />
            </label>
            <label className="account-profile-field">
              <span className="account-profile-field-label">工作方式</span>
              <SelectField
                label="工作方式"
                value={form.work_mode ?? ""}
                options={WORK_MODE_OPTIONS}
                onChange={(event) =>
                  update("work_mode", (event.target.value || null) as WorkMode | null)
                }
              />
            </label>
            <label className="account-profile-field">
              <span className="account-profile-field-label">可到岗时间</span>
              <SelectField
                label="可到岗时间"
                value={form.availability ?? ""}
                options={AVAILABILITY_OPTIONS}
                onChange={(event) =>
                  update("availability", (event.target.value || null) as ProfileForm["availability"])
                }
              />
            </label>
            {form.availability === "custom" && (
              <label className="account-profile-field">
                <span className="account-profile-field-label">自定义到岗日期</span>
                <Input
                  type="date"
                  aria-label="自定义到岗日期"
                  value={dateToString(form.available_from)}
                  onChange={(event) =>
                    update("available_from", stringToDate(event.target.value))
                  }
                />
              </label>
            )}
          </div>
          <div className="account-profile-tag-row">
            <span className="account-profile-field-label">职位方向</span>
            <TagInput
              values={form.target_positions}
              onChange={(next) => update("target_positions", next)}
              placeholder="回车或逗号添加，例如：前端工程师"
            />
          </div>
          <div className="account-profile-tag-row">
            <span className="account-profile-field-label">目标公司</span>
            <TagInput
              values={form.target_companies}
              onChange={(next) => update("target_companies", next)}
              placeholder="回车或逗号添加"
            />
          </div>
          <div className="account-profile-tag-row">
            <span className="account-profile-field-label">排除条件</span>
            <TagInput
              values={form.exclusions}
              onChange={(next) => update("exclusions", next)}
              placeholder="回车或逗号添加，例如：不接受大小周"
            />
          </div>
          <div className="account-profile-salary-toggle">
            <TogglePill
              active={salaryEnabled}
              onClick={() => setSalaryEnabled((current) => !current)}
            >
              填写期望薪资
            </TogglePill>
          </div>
          {salaryEnabled && (
            <div className="account-profile-salary-grid">
              <label className="account-profile-field">
                <span className="account-profile-field-label">薪资下限</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label="薪资下限"
                  value={form.salary_min ?? ""}
                  onChange={(event) =>
                    update("salary_min", nullableNumber(event.target.value))
                  }
                />
              </label>
              <label className="account-profile-field">
                <span className="account-profile-field-label">薪资上限</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label="薪资上限"
                  value={form.salary_max ?? ""}
                  onChange={(event) =>
                    update("salary_max", nullableNumber(event.target.value))
                  }
                />
              </label>
              <label className="account-profile-field">
                <span className="account-profile-field-label">币种</span>
                <Input
                  aria-label="薪资币种"
                  placeholder="CNY"
                  maxLength={3}
                  value={form.salary_currency ?? ""}
                  onChange={(event) =>
                    update("salary_currency", event.target.value.toUpperCase() || null)
                  }
                />
              </label>
              <label className="account-profile-field">
                <span className="account-profile-field-label">计薪周期</span>
                <SelectField
                  label="计薪周期"
                  value={form.salary_period ?? ""}
                  options={SALARY_PERIOD_OPTIONS}
                  onChange={(event) =>
                    update("salary_period", (event.target.value || null) as SalaryPeriod | null)
                  }
                />
              </label>
            </div>
          )}
        </fieldset>

        <fieldset className="account-profile-group">
          <legend>基础信息</legend>
          <div className="account-profile-fields">
            <label className="account-profile-field">
              <span className="account-profile-field-label">学校名称</span>
              <Input
                aria-label="学校名称"
                value={form.school ?? ""}
                maxLength={255}
                onChange={(event) => update("school", event.target.value || null)}
              />
            </label>
            <label className="account-profile-field">
              <span className="account-profile-field-label">专业方向</span>
              <Input
                aria-label="专业方向"
                value={form.major ?? ""}
                maxLength={100}
                onChange={(event) => update("major", event.target.value || null)}
              />
            </label>
            <label className="account-profile-field">
              <span className="account-profile-field-label">学历层次</span>
              <SelectField
                label="学历层次"
                value={form.education_level ?? ""}
                options={EDUCATION_LEVEL_OPTIONS}
                onChange={(event) =>
                  update("education_level", (event.target.value || null) as EducationLevel | null)
                }
              />
            </label>
            <label className="account-profile-field">
              <span className="account-profile-field-label">工作年限</span>
              <Input
                type="number"
                min={0}
                step={1}
                aria-label="工作年限"
                value={form.years_experience ?? ""}
                onChange={(event) =>
                  update("years_experience", nullableNumber(event.target.value))
                }
              />
            </label>
            <label className="account-profile-field">
              <span className="account-profile-field-label">出生日期</span>
              <Input
                type="date"
                aria-label="出生日期"
                value={dateToString(form.birth_date)}
                onChange={(event) =>
                  update("birth_date", stringToDate(event.target.value))
                }
              />
            </label>
          </div>
          <div className="account-profile-tag-row">
            <span className="account-profile-field-label">学校层级</span>
            <div className="account-profile-pill-group">
              {SCHOOL_TIER_OPTIONS.map((option) => (
                <TogglePill
                  key={option.value}
                  active={form.school_tier.includes(option.value)}
                  onClick={() => toggleSchoolTier(option.value)}
                >
                  {option.label}
                </TogglePill>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="account-profile-group">
          <legend>技能与荣誉</legend>
          <div className="account-profile-tag-row">
            <span className="account-profile-field-label">技能</span>
            <TagInput
              values={form.skills}
              onChange={(next) => update("skills", next)}
              placeholder="回车或逗号添加，例如：React、Python"
            />
          </div>
          <div className="account-profile-tag-row">
            <span className="account-profile-field-label">语言能力</span>
            <TagInput
              values={form.languages}
              onChange={(next) => update("languages", next)}
              placeholder="回车或逗号添加，例如：英语 CET-6"
            />
          </div>
          <div className="account-profile-tag-row">
            <span className="account-profile-field-label">证书</span>
            <TagInput
              values={form.certifications}
              onChange={(next) => update("certifications", next)}
              placeholder="回车或逗号添加，例如：PMP"
            />
          </div>
          <div className="account-profile-tag-row">
            <span className="account-profile-field-label">个人荣誉</span>
            <TagInput
              values={form.honors}
              onChange={(next) => update("honors", next)}
              placeholder="回车或逗号添加"
            />
          </div>
          <div className="account-profile-tag-row">
            <span className="account-profile-field-label">校园经历</span>
            <TagInput
              values={form.campus_experiences}
              onChange={(next) => update("campus_experiences", next)}
              placeholder="回车或逗号添加"
            />
          </div>
        </fieldset>
      </div>

      <footer className="account-profile-panel-footer">
        <Button variant="accent" disabled={saving} onClick={() => void save()}>
          {saving ? "保存中…" : "保存画像"}
        </Button>
        {notice && <FeedbackNotice kind={notice.kind}>{notice.message}</FeedbackNotice>}
      </footer>
    </section>
  );
}

type TagInputProps = {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
};

function TagInput({ values, onChange, placeholder }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commitDraft = () => {
    const parts = draft
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      setDraft("");
      return;
    }
    const existing = new Set(values);
    const next = [...values];
    for (const part of parts) {
      if (!existing.has(part) && part.length <= 100) {
        existing.add(part);
        next.push(part);
      }
    }
    onChange(next);
    setDraft("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="account-profile-tag-input">
      <ul className="account-profile-tag-list">
        {values.map((value) => (
          <li key={value} className="account-profile-tag">
            <span>{value}</span>
            <button
              type="button"
              aria-label={`移除 ${value}`}
              className="account-profile-tag-remove"
              onClick={() => onChange(values.filter((item) => item !== value))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        ref={inputRef}
        type="text"
        className="account-profile-tag-input-field"
        aria-label={placeholder ?? "添加标签"}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitDraft}
      />
    </div>
  );
}

import { MotionPresence, useContentMotion } from "@/components/ui/motion";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  api,
  ApiRequestError,
  type CandidateStatus,
  type EducationLevel,
  type EmploymentType,
  type SalaryPeriod,
  type SchoolTier,
  type UserProfileData,
  type UserProfileUpdate,
} from "../../api/client";
import { Icon } from "../../v3/Icon";
import { Dialog, Select, Toast } from "../../v3/primitives";
import { accountErrorMessage } from "./accountErrors";
import { ProfileBannerArt } from "./accountArt";
import { readPageCache, updatePageCache, writePageCache } from "@/v3/pageCache";

const USER_PROFILE_CACHE_KEY = "account-user-profile";

// 08.4「求职资料」区块里的「个人画像」一行 + 08.4g 编辑个人画像弹窗。
// 账号页不展示画像内容，只显示填写进度；读写仍走唯一的 GET/PUT /api/account/user-profile，保存带乐观锁。

type Notice = { kind: "success" | "error"; message: string } | null;

type ProfileForm = Omit<UserProfileData, "lock_version" | "created_at" | "updated_at">;

const MAX_CITIES = 20; // 后端 candidate_cities max_length=20

const EMPLOYMENT_TYPE_OPTIONS: Array<{ label: string; value: EmploymentType }> = [
  { label: "实习", value: "internship" },
  { label: "全职", value: "full_time" },
];

const CANDIDATE_STATUS_OPTIONS: Array<{ label: string; value: CandidateStatus }> = [
  { label: "应届生", value: "fresh_graduate" },
  { label: "非应届生", value: "experienced" },
];

const SALARY_PERIOD_OPTIONS: Array<{ label: string; value: SalaryPeriod }> = [
  { label: "月薪", value: "month" },
  { label: "年薪", value: "year" },
  { label: "日薪", value: "day" },
  { label: "时薪", value: "hour" },
];

const EDUCATION_LEVEL_OPTIONS: Array<{ label: string; value: EducationLevel }> = [
  { label: "高中及以下", value: "high_school" },
  { label: "大专", value: "junior_college" },
  { label: "本科", value: "bachelor" },
  { label: "硕士", value: "master" },
  { label: "博士", value: "doctor" },
];

const SCHOOL_TIER_OPTIONS: Array<{ label: string; value: SchoolTier }> = [
  { label: "985 院校", value: "project_985" },
  { label: "211 院校", value: "project_211" },
  { label: "双一流", value: "double_first_class" },
];

const EMPTY_FORM: ProfileForm = {
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
};

// 四个分类及其计入进度的字段（与设计稿左栏导航一致）
type CategoryId = "preferences" | "education" | "skills" | "honors";

const CATEGORIES: Array<{ id: CategoryId; label: string; hint: string }> = [
  { id: "preferences", label: "求职条件", hint: "找工作时最看重的几项" },
  { id: "education", label: "学历与院校", hint: "最高学历与就读院校" },
  { id: "skills", label: "技能与证书", hint: "技术栈、语言与资格证书" },
  { id: "honors", label: "荣誉与经历", hint: "奖项和校园实践" },
];

function filledItems(form: ProfileForm): Record<CategoryId, boolean[]> {
  const has = (values: string[]) => values.some((value) => value.trim() && value.trim() !== "无");
  return {
    preferences: [
      form.employment_types.length > 0,
      form.candidate_status != null,
      form.candidate_cities.length > 0,
      form.salary_min != null || form.salary_max != null,
      form.candidate_status === "fresh_graduate" ? form.graduation_year != null : form.years_experience != null,
    ],
    education: [form.education_level != null, Boolean(form.school), Boolean(form.major), form.school_tier.length > 0],
    skills: [has(form.skills), has(form.languages), has(form.certifications)],
    honors: [has(form.honors), has(form.campus_experiences)],
  };
}

export function profileProgress(form: ProfileForm) {
  const items = filledItems(form);
  const all = Object.values(items).flat();
  return {
    filled: all.filter(Boolean).length,
    total: all.length,
    byCategory: Object.fromEntries(
      Object.entries(items).map(([key, values]) => [key, values.length - values.filter(Boolean).length]),
    ) as Record<CategoryId, number>,
  };
}

function toFormState(data: UserProfileData | null | undefined): ProfileForm {
  if (!data) return { ...EMPTY_FORM };
  const { lock_version: _lock, created_at: _created, updated_at: _updated, ...rest } = data;
  return {
    ...EMPTY_FORM,
    ...rest,
    // 后端 Decimal 可能以字符串返回，这里统一成数字
    salary_min: rest.salary_min == null ? null : Number(rest.salary_min),
    salary_max: rest.salary_max == null ? null : Number(rest.salary_max),
    candidate_cities: [...rest.candidate_cities],
    employment_types: [...rest.employment_types],
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

function normalizeStringArray(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function hasAnyProfileData(profile: UserProfileData | null): boolean {
  if (!profile) return false;
  return profileProgress(toFormState(profile)).filled > 0;
}

function formatUpdatedAt(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 标签输入：白底描边框，内部是 24 高的小标签，末尾接输入框
// ---------------------------------------------------------------------------
function TagInput({
  tags,
  placeholder = "输入后回车添加…",
  ariaLabel,
  max,
  onChange,
}: {
  tags: string[];
  placeholder?: string;
  ariaLabel: string;
  max?: number;
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const full = max != null && tags.length >= max;

  const addTag = (text: string) => {
    const parts = text.trim().split(/[,，]/).map((value) => value.trim()).filter(Boolean);
    if (parts.length > 0) {
      const next = normalizeStringArray([...tags, ...parts]);
      onChange(max != null ? next.slice(0, max) : next);
    }
    setDraft("");
  };

  const removeTag = (index: number) => onChange(tags.filter((_, current) => current !== index));

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 中文输入法选词期间的回车不算提交
    if (event.nativeEvent.isComposing || isComposingRef.current || event.keyCode === 229) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(draft);
    } else if (event.key === "Backspace" && !draft && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  return (
    <div className="prof-tags" onClick={() => inputRef.current?.focus()}>
      {tags.map((tag, index) => (
        <span key={`${tag}-${index}`} className="prof-tag">
          {tag}
          <button
            type="button"
            aria-label={`移除 ${tag}`}
            onClick={(event) => {
              event.stopPropagation();
              removeTag(index);
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        aria-label={ariaLabel}
        disabled={full}
        placeholder={full ? `最多 ${max} 个` : tags.length === 0 ? placeholder : "继续添加…"}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false;
        }}
        onBlur={() => addTag(draft)}
      />
    </div>
  );
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="prof-label">
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </div>
  );
}

// 数字输入框，右侧带单位 / 说明（「最低」「年」）
function NumberField({ value, ariaLabel, suffix, placeholder, min, max, step = 1, onChange }: {
  value: number | null;
  ariaLabel: string;
  suffix?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="prof-num">
      <input
        className="v3-input"
        type="number"
        inputMode="numeric"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        value={value == null ? "" : Number(value)}
        onChange={(event) => onChange(nullableNumber(event.target.value))}
      />
      {suffix && <span>{suffix}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// 账号页里的一行入口
// ---------------------------------------------------------------------------
export function UserProfilePanel() {
  // 个人画像进度也走短时缓存：回到账号页时直接显示上次的进度，超过 5 分钟再后台刷新
  const [serverData, setServerData] = useState<UserProfileData | null>(() => readPageCache<UserProfileData>(USER_PROFILE_CACHE_KEY)?.value ?? null);
  const [loading, setLoading] = useState(() => !readPageCache(USER_PROFILE_CACHE_KEY));
  const [failed, setFailed] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    let active = true;
    const cached = readPageCache<UserProfileData>(USER_PROFILE_CACHE_KEY);
    if (cached?.fresh) return undefined;
    void api
      .getUserProfile()
      .then((data) => {
        if (!active) return;
        setServerData(data);
        writePageCache(USER_PROFILE_CACHE_KEY, data);
        setFailed(false);
      })
      .catch(() => {
        if (active && !cached) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const progress = serverData ? profileProgress(toFormState(serverData)) : null;
  const unavailable = failed && !serverData;
  const status = loading
    ? "正在读取…"
    : unavailable
      ? "个人画像暂不可用，请稍后重试。"
      : hasAnyProfileData(serverData)
        ? `已填 ${progress!.filled} / ${progress!.total} 项`
        : null;

  return (
    <>
      <button
        type="button"
        className="acc-row is-button"
        aria-label="个人画像"
        disabled={loading || unavailable}
        onClick={() => setEditDialogOpen(true)}
      >
        <span className="acc-row-label">个人画像</span>
        <span className="acc-row-value">城市、薪资、学历等 · 所有简历共用</span>
        <span className="acc-row-right">
          {status ? <span className="acc-row-meta">{status}</span> : <span className="acc-row-meta is-strong">去填写</span>}
          {!loading && !unavailable && <Icon name="chev" size={12} />}
        </span>
      </button>

      <MotionPresence>{editDialogOpen && (
        <UserProfileEditDialog
          serverData={serverData}
          onClose={() => setEditDialogOpen(false)}
          onSaved={(profile) => {
            setServerData(profile);
            updatePageCache(USER_PROFILE_CACHE_KEY, profile);
            setEditDialogOpen(false);
            setNotice({ kind: "success", message: "个人画像已保存。" });
          }}
          onConflict={(latest) => { setServerData(latest); updatePageCache(USER_PROFILE_CACHE_KEY, latest); }}
          onNotice={setNotice}
        />
      )}</MotionPresence>

      <MotionPresence>{notice && (
        <Toast
          kind={notice.kind}
          title={notice.kind === "success" ? "已保存" : "保存失败"}
          message={notice.message}
          onDismiss={() => setNotice(null)}
        />
      )}</MotionPresence>
    </>
  );
}

// ---------------------------------------------------------------------------
// 08.4g 编辑个人画像（720×670）
// ---------------------------------------------------------------------------
function UserProfileEditDialog({
  serverData,
  onClose,
  onSaved,
  onConflict,
  onNotice,
}: {
  serverData: UserProfileData | null;
  onClose: () => void;
  onSaved: (profile: UserProfileData) => void;
  onConflict: (latest: UserProfileData) => void;
  onNotice: (notice: Notice) => void;
}) {
  const [active, setActive] = useState<CategoryId>("preferences");
  // 左侧分类是竖排的：往下切换时内容从下方滑入，往上切换时从上方滑入
  const previousCategory = useRef<CategoryId>(active);
  const categoryOrder = (id: CategoryId) => CATEGORIES.findIndex((item) => item.id === id);
  const paneFrom = categoryOrder(active) > categoryOrder(previousCategory.current) ? "0 16px" : categoryOrder(active) < categoryOrder(previousCategory.current) ? "0 -16px" : "0 0";
  useEffect(() => { previousCategory.current = active; }, [active]);
  const paneRef = useContentMotion<HTMLDivElement>(active, { from: paneFrom });
  const [form, setForm] = useState<ProfileForm>(() => toFormState(serverData));
  const [saving, setSaving] = useState(false);
  const progress = profileProgress(form);
  const empty = progress.filled === 0;
  const updatedAt = formatUpdatedAt(serverData?.updated_at);

  const updateField = <Key extends keyof ProfileForm>(key: Key, value: ProfileForm[Key]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const toggleIn = <Key extends "employment_types" | "school_tier">(key: Key, value: ProfileForm[Key][number]) => {
    setForm((previous) => {
      const list = previous[key] as string[];
      return { ...previous, [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value] };
    });
  };

  // 应届生：工作年限固定 0、只填毕业年份；非应届生：清空毕业年份、只填工作年限
  const selectCandidateStatus = (value: CandidateStatus) => {
    setForm((previous) => {
      if (previous.candidate_status === value) return previous;
      if (value === "fresh_graduate") return { ...previous, candidate_status: value, years_experience: 0 };
      return {
        ...previous,
        candidate_status: value,
        graduation_year: null,
        years_experience: previous.candidate_status === "fresh_graduate" ? null : previous.years_experience,
      };
    });
  };

  const handleSave = async () => {
    if (saving) return;
    onNotice(null);

    if (form.salary_min != null && form.salary_max != null && form.salary_max < form.salary_min) {
      onNotice({ kind: "error", message: "最高薪资不能低于最低薪资。" });
      return;
    }
    const hasNumericSalary = form.salary_min != null || form.salary_max != null;
    const currencyCandidate = form.salary_currency?.trim().toUpperCase() || (hasNumericSalary ? "CNY" : null);
    if (hasNumericSalary && currencyCandidate && !/^[A-Z]{3}$/.test(currencyCandidate)) {
      onNotice({ kind: "error", message: "薪资币种必须为 3 位英文字母代码（例如：CNY、USD）。" });
      return;
    }
    if (
      form.candidate_status === "fresh_graduate" &&
      (form.graduation_year == null || !Number.isInteger(form.graduation_year) || form.graduation_year < 1900 || form.graduation_year > 9999)
    ) {
      onNotice({ kind: "error", message: "应届生请填写 1900–9999 之间的四位毕业年份。" });
      return;
    }

    setSaving(true);
    const payload: UserProfileUpdate = {
      candidate_cities: normalizeStringArray(form.candidate_cities).slice(0, MAX_CITIES),
      salary_min: form.salary_min != null && form.salary_min >= 0 ? form.salary_min : null,
      salary_max: form.salary_max != null && form.salary_max >= 0 ? form.salary_max : null,
      salary_currency: hasNumericSalary ? currencyCandidate || "CNY" : null,
      salary_period: hasNumericSalary ? form.salary_period || "month" : null,
      employment_types: Array.from(new Set(form.employment_types)),
      school: form.school?.trim() || null,
      school_tier: Array.from(new Set(form.school_tier)),
      major: form.major?.trim() || null,
      education_level: form.education_level || null,
      candidate_status: form.candidate_status || null,
      graduation_year: form.candidate_status === "fresh_graduate" ? form.graduation_year : null,
      years_experience:
        form.candidate_status === "fresh_graduate"
          ? 0
          : form.years_experience != null && form.years_experience >= 0 && Number.isInteger(form.years_experience)
            ? form.years_experience
            : null,
      languages: normalizeStringArray(form.languages),
      skills: normalizeStringArray(form.skills),
      certifications: normalizeStringArray(form.certifications),
      honors: normalizeStringArray(form.honors),
      campus_experiences: normalizeStringArray(form.campus_experiences),
      base_lock_version: serverData?.lock_version ?? 1,
    };

    try {
      const updated = await api.putUserProfile(payload);
      onSaved(updated);
    } catch (error: unknown) {
      if (
        error instanceof ApiRequestError &&
        (error.message === "USER_PROFILE_VERSION_CONFLICT" || (error as { code?: string }).code === "USER_PROFILE_VERSION_CONFLICT")
      ) {
        // 乐观锁冲突：刷新成最新版本，让用户确认后再保存，不自动重放
        const latestProfile = (error.payload as { profile?: UserProfileData } | null)?.profile;
        if (latestProfile) {
          onConflict(latestProfile);
          setForm(toFormState(latestProfile));
          onNotice({ kind: "error", message: "数据已被其他写入方修改，已刷新为最新版本，请确认后重试。" });
        } else {
          onNotice({ kind: "error", message: "数据版本冲突，请重新打开编辑窗口后保存。" });
        }
      } else {
        onNotice({ kind: "error", message: accountErrorMessage(error, "保存个人画像失败，请重试。") });
      }
    } finally {
      setSaving(false);
    }
  };

  const category = CATEGORIES.find((item) => item.id === active)!;
  const currencyLabel = !form.salary_currency || form.salary_currency === "CNY" ? "人民币" : form.salary_currency;
  const periodLabel = SALARY_PERIOD_OPTIONS.find((option) => option.value === (form.salary_period ?? "month"))?.label;

  return (
    <Dialog width={720} label="编辑个人画像" onClose={() => { if (!saving) onClose(); }} className="prof-dialog" closable={!saving}>
      <div className="v3-dialog-body prof-body">
        <h2 className="v3-dialog-title">编辑个人画像</h2>
        <p className="v3-dialog-sub">求职城市、期望薪资和学历只填一次，所有简历共用。</p>
        <div className="v3-stage prof-art">
          <ProfileBannerArt empty={empty} />
        </div>

        <div className="prof-grid">
          <nav className="prof-nav" aria-label="画像分类">
            <strong className="prof-total">已填 {progress.filled} / {progress.total} 项</strong>
            <span className="prof-bar" aria-hidden="true">
              <span style={{ width: `${(progress.filled / progress.total) * 100}%` }} />
            </span>
            <div role="tablist" aria-label="画像分类" className="prof-tabs">
              {CATEGORIES.map((item) => {
                const missing = progress.byCategory[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active === item.id}
                    className="prof-tab"
                    onClick={() => setActive(item.id)}
                  >
                    <span>{item.label}</span>
                    <small className={missing ? "is-missing" : "is-done"}>{missing ? `差 ${missing} 项` : "已填完"}</small>
                  </button>
                );
              })}
            </div>
          </nav>

          <div ref={paneRef} className="prof-pane" role="tabpanel" aria-label={category.label}>
            <div className="prof-pane-head">
              <h3>{category.label}</h3>
              <small>{category.hint}</small>
            </div>

            {active === "preferences" && (
              <div className="prof-fields">
                <div className="prof-row">
                  <div className="prof-field">
                    <FieldLabel label="工作性质" hint="可多选" />
                    <div className="v3-seg" role="group" aria-label="工作性质">
                      {EMPLOYMENT_TYPE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={form.employment_types.includes(option.value)}
                          onClick={() => toggleIn("employment_types", option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="prof-field">
                    <FieldLabel label="工作经验" />
                    <div className="v3-seg" role="group" aria-label="工作经验">
                      {CANDIDATE_STATUS_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={form.candidate_status === option.value}
                          onClick={() => selectCandidateStatus(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="prof-field">
                  <FieldLabel label="可接受工作城市" hint={`最多 ${MAX_CITIES} 个`} />
                  <TagInput
                    tags={form.candidate_cities}
                    max={MAX_CITIES}
                    placeholder="如：北京、上海、杭州"
                    ariaLabel="可接受工作城市"
                    onChange={(tags) => updateField("candidate_cities", tags)}
                  />
                </div>

                <div className="prof-field">
                  <FieldLabel label="期望薪资" hint={`${currencyLabel} · ${periodLabel}`} />
                  <div className="prof-row">
                    <NumberField value={form.salary_min} ariaLabel="最低薪资" suffix="最低" min={0} step={1000} onChange={(value) => updateField("salary_min", value)} />
                    <NumberField value={form.salary_max} ariaLabel="最高薪资" suffix="最高" min={0} step={1000} onChange={(value) => updateField("salary_max", value)} />
                  </div>
                  <div className="prof-row">
                    <input
                      className="v3-input"
                      aria-label="薪资币种"
                      maxLength={3}
                      placeholder="币种，如 CNY"
                      value={form.salary_currency ?? "CNY"}
                      onChange={(event) => updateField("salary_currency", event.target.value.toUpperCase().trim() || null)}
                    />
                    <Select
                      label="计薪周期"
                      value={form.salary_period ?? "month"}
                      options={SALARY_PERIOD_OPTIONS}
                      onChange={(value) => updateField("salary_period", value)}
                    />
                  </div>
                </div>

                {form.candidate_status === "experienced" && (
                  <div className="prof-row">
                    <div className="prof-field">
                      <FieldLabel label="工作年限" />
                      <NumberField value={form.years_experience} ariaLabel="工作年限" suffix="年" min={0} max={60} placeholder="例如：3" onChange={(value) => updateField("years_experience", value == null ? null : Math.trunc(value))} />
                    </div>
                  </div>
                )}
                {form.candidate_status === "fresh_graduate" && (
                  <div className="prof-row">
                    <div className="prof-field">
                      <FieldLabel label="毕业年份" />
                      <NumberField value={form.graduation_year} ariaLabel="毕业年份" min={1900} max={9999} placeholder="例如：2026" onChange={(value) => updateField("graduation_year", value == null ? null : Math.trunc(value))} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {active === "education" && (
              <div className="prof-fields">
                <div className="prof-row">
                  <div className="prof-field">
                    <FieldLabel label="学历层次" />
                    <Select
                      label="学历层次"
                      value={form.education_level ?? ""}
                      placeholder="请选择学历层次"
                      options={EDUCATION_LEVEL_OPTIONS}
                      onChange={(value) => updateField("education_level", value)}
                    />
                  </div>
                  <div className="prof-field">
                    <FieldLabel label="毕业院校" />
                    <input className="v3-input" aria-label="毕业院校" maxLength={255} placeholder="例如：北京大学" value={form.school ?? ""} onChange={(event) => updateField("school", event.target.value.trim() || null)} />
                  </div>
                </div>
                <div className="prof-field">
                  <FieldLabel label="专业方向" />
                  <input className="v3-input" aria-label="专业方向" maxLength={100} placeholder="例如：计算机科学与技术" value={form.major ?? ""} onChange={(event) => updateField("major", event.target.value.trim() || null)} />
                </div>
                <div className="prof-field">
                  <FieldLabel label="学校标签" hint="可多选" />
                  <div className="v3-seg" role="group" aria-label="学校标签">
                    {SCHOOL_TIER_OPTIONS.map((option) => (
                      <button key={option.value} type="button" aria-pressed={form.school_tier.includes(option.value)} onClick={() => toggleIn("school_tier", option.value)}>
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {active === "skills" && (
              <div className="prof-fields">
                <div className="prof-field">
                  <FieldLabel label="专业技能" hint="个人技术栈或业务专长" />
                  <TagInput tags={form.skills} placeholder="如：React、TypeScript、FastAPI、MySQL" ariaLabel="专业技能" onChange={(tags) => updateField("skills", tags)} />
                </div>
                <div className="prof-field">
                  <FieldLabel label="语言能力" hint="外语水平与证书等级" />
                  <TagInput tags={form.languages} placeholder="如：英语 CET-6、日语 N1" ariaLabel="语言能力" onChange={(tags) => updateField("languages", tags)} />
                </div>
                <div className="prof-field">
                  <FieldLabel label="专业证书" hint="行业资格认证" />
                  <TagInput tags={form.certifications} placeholder="如：PMP、AWS 认证架构师" ariaLabel="专业证书" onChange={(tags) => updateField("certifications", tags)} />
                </div>
              </div>
            )}

            {active === "honors" && (
              <div className="prof-fields">
                <div className="prof-field">
                  <FieldLabel label="荣誉奖项" hint="比赛获奖、优秀表彰" />
                  <TagInput tags={form.honors} placeholder="如：国家奖学金、年度优秀员工" ariaLabel="荣誉奖项" onChange={(tags) => updateField("honors", tags)} />
                </div>
                <div className="prof-field">
                  <FieldLabel label="校园经历" hint="社团、学生会、竞赛实践等" />
                  <TagInput tags={form.campus_experiences} placeholder="如：学生会主席、开源社团核心成员" ariaLabel="校园经历" onChange={(tags) => updateField("campus_experiences", tags)} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="v3-dialog-foot">
        <div className="v3-dialog-foot-left">
          <span className="prof-updated">{updatedAt ? `最近更新于 ${updatedAt}` : "还没有保存过"}</span>
        </div>
        <button type="button" className="v3-btn v3-btn-ghost acc-btn-80" disabled={saving} onClick={onClose}>取消</button>
        <button type="button" className="v3-btn v3-btn-dark" style={{ width: 96 }} disabled={saving} onClick={() => void handleSave()}>
          {saving ? "保存中…" : "保存画像"}
        </button>
      </div>
    </Dialog>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Award,
  Briefcase,
  Check,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  Pencil,
  UserPlus,
  X,
} from "lucide-react";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FeedbackNotice,
  Label,
  PageLoading,
  TextField,
  TogglePill,
} from "@/components/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { accountErrorMessage } from "./AccountPage";

type Notice = { kind: "success" | "error"; message: string } | null;

type ProfileForm = Omit<
  UserProfileData,
  "lock_version" | "created_at" | "updated_at"
>;

const EMPLOYMENT_TYPE_OPTIONS: Array<{ label: string; value: EmploymentType }> = [
  { label: "实习", value: "internship" },
  { label: "全职", value: "full_time" },
];

const CANDIDATE_STATUS_OPTIONS: Array<{
  label: string;
  value: CandidateStatus;
}> = [
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

function formatProfileTime(isoString?: string | null): string {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch {
    return "";
  }
}

function toFormState(data: UserProfileData | null | undefined): ProfileForm {
  if (!data) return { ...EMPTY_FORM };
  const { lock_version: _lock, created_at: _created, updated_at: _updated, ...rest } = data;
  return {
    ...EMPTY_FORM,
    ...rest,
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

function formatSalary(profile: UserProfileData): string | null {
  if (profile.salary_min == null && profile.salary_max == null) return null;
  const periodMap: Record<SalaryPeriod, string> = {
    month: "月",
    year: "年",
    day: "日",
    hour: "时",
  };
  const period = profile.salary_period
    ? ` / ${periodMap[profile.salary_period] ?? profile.salary_period}`
    : "";
  const currency =
    profile.salary_currency && profile.salary_currency !== "CNY"
      ? ` (${profile.salary_currency})`
      : "";
  const formatAmount = (value: number) =>
    value >= 1000 && value % 1000 === 0 ? `${value / 1000}k` : `${value}元`;

  if (profile.salary_min != null && profile.salary_max != null) {
    return `${formatAmount(profile.salary_min)} - ${formatAmount(profile.salary_max)}${period}${currency}`;
  }
  if (profile.salary_min != null) {
    return `${formatAmount(profile.salary_min)}+${period}${currency}`;
  }
  return `≤ ${formatAmount(profile.salary_max!)}${period}${currency}`;
}

function getEmploymentTypeLabel(value: EmploymentType): string {
  return EMPLOYMENT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function getEducationLevelLabel(value: EducationLevel | null | undefined): string | null {
  if (!value) return null;
  return EDUCATION_LEVEL_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function formatExperience(profile: UserProfileData): string | null {
  if (profile.candidate_status === "fresh_graduate") {
    return profile.graduation_year != null
      ? `应届生 · ${profile.graduation_year} 届`
      : "应届生";
  }
  if (profile.candidate_status === "experienced") {
    return profile.years_experience != null
      ? `${profile.years_experience} 年经验`
      : null;
  }
  if (profile.years_experience != null) {
    return `${profile.years_experience} 年经验`;
  }
  return null;
}

function hasAnyProfileData(profile: UserProfileData | null): boolean {
  if (!profile) return false;
  return Boolean(
    profile.candidate_cities.length > 0 ||
      profile.salary_min != null ||
      profile.salary_max != null ||
      profile.employment_types.length > 0 ||
      profile.school ||
      profile.school_tier.length > 0 ||
      profile.major ||
      profile.education_level ||
      profile.candidate_status ||
      profile.graduation_year != null ||
      profile.years_experience != null ||
      profile.languages.length > 0 ||
      profile.skills.length > 0 ||
      profile.certifications.length > 0 ||
      profile.honors.length > 0 ||
      profile.campus_experiences.length > 0,
  );
}

// ---------------------------------------------------------------------------
// 标签输入子组件
// ---------------------------------------------------------------------------
interface TagInputProps {
  label?: string;
  hint?: string;
  tags: string[];
  placeholder?: string;
  ariaLabel?: string;
  presets?: string[];
  onChange: (tags: string[]) => void;
}

function TagInput({
  label,
  hint,
  tags,
  placeholder = "输入后回车添加…",
  ariaLabel,
  presets,
  onChange,
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);

  const addTag = (text: string) => {
    const parts = text
      .trim()
      .split(/[,，]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (parts.length > 0) onChange(normalizeStringArray([...tags, ...parts]));
    setDraft("");
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, currentIndex) => currentIndex !== index));
  };

  const togglePreset = (preset: string) => {
    if (tags.includes(preset)) {
      onChange(tags.filter((tag) => tag !== preset));
    } else {
      onChange([...tags, preset]);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.nativeEvent.isComposing ||
      isComposingRef.current ||
      event.keyCode === 229
    ) {
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(draft);
    } else if (event.key === "Backspace" && !draft && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  return (
    <div className="account-profile-tag-row">
      {(label || hint) && (
        <div className="account-profile-tag-header">
          {label && <Label className="account-profile-field-label">{label}</Label>}
          {hint && <span className="account-profile-field-hint">{hint}</span>}
        </div>
      )}
      <div
        className="account-profile-tag-input"
        onClick={() => inputRef.current?.focus()}
      >
        <ul className="account-profile-tag-list" aria-label={label}>
          {tags.map((tag, index) => (
            <li key={`${tag}-${index}`} className="account-profile-tag-item">
              <Badge variant="secondary" className="account-profile-tag-badge">
                <span className="account-profile-tag-text">{tag}</span>
                <button
                  type="button"
                  className="account-profile-tag-remove"
                  aria-label={`移除 ${tag}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeTag(index);
                  }}
                >
                  <X size={12} aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
        <input
          ref={inputRef}
          type="text"
          className="account-profile-tag-input-field"
          value={draft}
          aria-label={ariaLabel || label || placeholder}
          placeholder={tags.length === 0 ? placeholder : "继续添加…"}
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
      {presets && presets.length > 0 && (
        <div className="account-profile-preset-group" aria-label={`${label}常用预设`}>
          <span className="account-profile-preset-label">常用</span>
          <div className="account-profile-pill-group">
            {presets.map((preset) => (
              <TogglePill
                key={preset}
                active={tags.includes(preset)}
                onClick={() => togglePreset(preset)}
              >
                {preset}
              </TogglePill>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------
export function UserProfilePanel() {
  const [serverData, setServerData] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .getUserProfile()
      .then((data) => {
        if (!active) return;
        setServerData(data);
        setFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSaved = (newProfile: UserProfileData) => {
    setServerData(newProfile);
    setEditDialogOpen(false);
  };

  const handleConflict = (latestProfile: UserProfileData) => {
    setServerData(latestProfile);
  };

  if (loading) {
    return (
      <section className="account-profile-panel" aria-label="个人画像">
        <PageLoading label="正在加载个人画像…" />
      </section>
    );
  }

  if (failed && !serverData) {
    return (
      <section className="account-profile-panel" aria-label="个人画像">
        <header className="account-profile-panel-header">
          <div className="account-profile-panel-header-text">
            <h2 id="account-profile-heading">个人画像</h2>
          </div>
        </header>
        <p className="account-profile-panel-empty">
          个人画像暂不可用，请稍后重试。
        </p>
      </section>
    );
  }

  const hasData = hasAnyProfileData(serverData);
  const salaryText = serverData ? formatSalary(serverData) : null;
  const experienceText = serverData ? formatExperience(serverData) : null;
  const educationLevelText = serverData
    ? getEducationLevelLabel(serverData.education_level)
    : null;
  const skillDisplayFields = serverData
    ? [
        { label: "专业技能", values: serverData.skills },
        { label: "语言能力", values: serverData.languages },
        { label: "专业证书", values: serverData.certifications },
        { label: "荣誉奖项", values: serverData.honors },
        { label: "校园经历", values: serverData.campus_experiences },
      ]
        .map((field) => ({
          ...field,
          values: field.values
            .map((value) => value.trim())
            .filter((value) => value && value !== "无"),
        }))
        .filter((field) => field.values.length > 0)
    : [];

  return (
    <section className="account-profile-panel" aria-label="个人画像">
      <header className="account-profile-panel-header">
        <div className="account-profile-panel-header-text">
          <h2 id="account-profile-heading">个人画像</h2>
          <p>跨简历共享的求职条件与个人基础信息</p>
        </div>
        <Button
          variant="outline"
          className="account-profile-edit-btn"
          onClick={() => setEditDialogOpen(true)}
        >
          <Pencil size={15} aria-hidden />
          编辑
        </Button>
      </header>

      <div className="account-profile-panel-body">
        {!hasData ? (
          <div className="account-profile-display-empty">
            <div className="account-profile-empty-icon">
              <UserPlus size={32} aria-hidden />
            </div>
            <h3>暂未完善个人画像</h3>
            <p>完善求职条件、教育背景和技能成果，为后续岗位比较提供更完整的依据。</p>
            <Button
              variant="default"
              size="sm"
              onClick={() => setEditDialogOpen(true)}
            >
              <Pencil size={14} aria-hidden />
              立即完善个人画像
            </Button>
          </div>
        ) : (
          <div className="account-profile-display-content">
            <div className="account-profile-display-group">
              <div className="account-profile-display-group-header">
                <span className="account-profile-display-group-title">
                  <Briefcase size={18} aria-hidden />
                  求职与经验
                </span>
              </div>
              <div className="account-profile-display-group-body">
                <div className="account-profile-display-meta-grid account-profile-display-meta-grid-2x2">
                  <div className="account-profile-display-meta-item">
                    <span className="account-profile-display-meta-label">可接受城市</span>
                    <span className="account-profile-display-meta-value">
                      {serverData?.candidate_cities.slice(0, 3).join("、") || "未指定"}
                    </span>
                  </div>
                  <div className="account-profile-display-meta-item">
                    <span className="account-profile-display-meta-label">期望薪资</span>
                    <span className="account-profile-display-meta-value">
                      {salaryText || "面议 / 未指定"}
                    </span>
                  </div>
                  <div className="account-profile-display-meta-item">
                    <span className="account-profile-display-meta-label">工作性质</span>
                    <span className="account-profile-display-meta-value">
                      {serverData?.employment_types.map(getEmploymentTypeLabel).join(" · ") || "未指定"}
                    </span>
                  </div>
                  <div className="account-profile-display-meta-item">
                    <span className="account-profile-display-meta-label">工作经验</span>
                    <span className="account-profile-display-meta-value">
                      {experienceText || "未填写"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="account-profile-display-group">
              <div className="account-profile-display-group-header">
                <span className="account-profile-display-group-title">
                  <GraduationCap size={18} aria-hidden />
                  教育背景
                </span>
              </div>
              <div className="account-profile-display-group-body">
                <div className="account-profile-display-meta-grid account-profile-display-meta-grid-education">
                  <div className="account-profile-display-meta-item">
                    <span className="account-profile-display-meta-label">学历与院校</span>
                    <span className="account-profile-display-meta-value">
                      {[educationLevelText, serverData?.school]
                        .filter(Boolean)
                        .join(" · ") || "未填写"}
                    </span>
                  </div>
                  <div className="account-profile-display-meta-item">
                    <span className="account-profile-display-meta-label">专业方向</span>
                    <span className="account-profile-display-meta-value">
                      {serverData?.major || "未填写"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="account-profile-display-group">
              <div className="account-profile-display-group-header">
                <span className="account-profile-display-group-title">
                  <Award size={18} aria-hidden />
                  技能与成果
                </span>
              </div>
              <div className="account-profile-display-group-body">
                {skillDisplayFields.length > 0 ? (
                  <div className="account-profile-display-meta-grid account-profile-display-meta-grid-skills">
                    {skillDisplayFields.map((field) => (
                      <div
                        key={field.label}
                        className="account-profile-display-meta-item"
                      >
                        <span className="account-profile-display-meta-label">{field.label}</span>
                        <span className="account-profile-display-meta-value">
                          {field.values.join("、")}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="account-profile-display-empty-text">无</span>
                )}
              </div>
            </div>

            <div className="account-profile-display-footer">
              <span>画像数据已跨简历共享，用于岗位条件比较</span>
              <span>
                {serverData?.updated_at
                  ? `最近更新于 ${formatProfileTime(serverData.updated_at)}`
                  : "已同步最新版本"}
              </span>
            </div>
          </div>
        )}
      </div>

      <UserProfileEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        serverData={serverData}
        onSaved={handleSaved}
        onConflict={handleConflict}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// 表单下拉选择组件
// ---------------------------------------------------------------------------
function ProfileSelectField({
  label,
  value,
  placeholder = "未填写",
  options,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  placeholder?: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  const id = `profile-select-${label.replace(/[\s（）]/g, "-")}`;
  return (
    <div className="account-profile-field">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || ""} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label={label} className="account-profile-select-trigger">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ProfileNumberField({
  label,
  value,
  placeholder,
  min,
  max,
  step = 1,
  ariaLabel,
  onChange,
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
  onChange: (value: number | null) => void;
}) {
  const adjust = (direction: -1 | 1) => {
    const numericValue = value == null ? null : Number(value);
    const base = numericValue ?? min ?? 0;
    const candidate = base + (numericValue == null && min != null ? 0 : step * direction);
    onChange(Math.min(max ?? candidate, Math.max(min ?? candidate, candidate)));
  };

  return (
    <div className="account-profile-number-field">
      <TextField
        className="account-profile-number-text-field"
        inputClassName="account-profile-number-input"
        type="number"
        min={min}
        max={max}
        step={step}
        label={label}
        value={value == null ? "" : Number(value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? label}
        onChange={(event) => onChange(nullableNumber(event.target.value))}
      />
      <div className="account-profile-number-controls">
        <button
          type="button"
          className="account-profile-number-control"
          aria-label={`${ariaLabel ?? label}增加`}
          disabled={value != null && max != null && value >= max}
          onClick={() => adjust(1)}
        >
          <ChevronUp size={12} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className="account-profile-number-control"
          aria-label={`${ariaLabel ?? label}减少`}
          disabled={value != null && min != null && value <= min}
          onClick={() => adjust(-1)}
        >
          <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </div>
  );
}

interface UserProfileEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverData: UserProfileData | null;
  onSaved: (newProfile: UserProfileData) => void;
  onConflict: (latestProfile: UserProfileData) => void;
}

type EditTabId = "preferences" | "education" | "skills";

function UserProfileEditDialog({
  open,
  onOpenChange,
  serverData,
  onSaved,
  onConflict,
}: UserProfileEditDialogProps) {
  const [activeTab, setActiveTab] = useState<EditTabId>("preferences");
  const [form, setForm] = useState<ProfileForm>(() => toFormState(serverData));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!open) return;
    setForm(toFormState(serverData));
    setNotice(null);
  }, [open]);

  const updateField = <Key extends keyof ProfileForm>(
    key: Key,
    value: ProfileForm[Key],
  ) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const toggleEmploymentType = (value: EmploymentType) => {
    setForm((previous) => ({
      ...previous,
      employment_types: previous.employment_types.includes(value)
        ? previous.employment_types.filter((item) => item !== value)
        : [...previous.employment_types, value],
    }));
  };

  const toggleSchoolTier = (value: SchoolTier) => {
    setForm((previous) => ({
      ...previous,
      school_tier: previous.school_tier.includes(value)
        ? previous.school_tier.filter((item) => item !== value)
        : [...previous.school_tier, value],
    }));
  };

  const selectCandidateStatus = (value: CandidateStatus) => {
    setForm((previous) => {
      // The status is optional for an untouched profile. Once selected from
      // the dropdown, it stays explicit until the user chooses another type.
      if (previous.candidate_status === value) return previous;
      if (value === "fresh_graduate") {
        return {
          ...previous,
          candidate_status: value,
          years_experience: 0,
        };
      }
      return {
        ...previous,
        candidate_status: value,
        graduation_year: null,
        years_experience:
          previous.candidate_status === "fresh_graduate"
            ? null
            : previous.years_experience,
      };
    });
  };

  const handleSave = async () => {
    if (saving) return;
    setNotice(null);

    if (
      form.salary_min != null &&
      form.salary_max != null &&
      form.salary_max < form.salary_min
    ) {
      setNotice({ kind: "error", message: "最高薪资不能低于最低薪资。" });
      return;
    }

    const hasNumericSalary = form.salary_min != null || form.salary_max != null;
    const currencyCandidate =
      form.salary_currency?.trim().toUpperCase() || (hasNumericSalary ? "CNY" : null);
    if (hasNumericSalary && currencyCandidate && !/^[A-Z]{3}$/.test(currencyCandidate)) {
      setNotice({
        kind: "error",
        message: "薪资币种必须为 3 位英文字母代码（例如：CNY、USD）。",
      });
      return;
    }

    if (
      form.candidate_status === "fresh_graduate" &&
      (form.graduation_year == null ||
        !Number.isInteger(form.graduation_year) ||
        form.graduation_year < 1900 ||
        form.graduation_year > 9999)
    ) {
      setNotice({ kind: "error", message: "应届生请填写 1900–9999 之间的四位毕业年份。" });
      return;
    }

    setSaving(true);
    const payload: UserProfileUpdate = {
      candidate_cities: normalizeStringArray(form.candidate_cities),
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
      graduation_year:
        form.candidate_status === "fresh_graduate" ? form.graduation_year : null,
      years_experience:
        form.candidate_status === "fresh_graduate"
          ? 0
          : form.years_experience != null &&
              form.years_experience >= 0 &&
              Number.isInteger(form.years_experience)
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
      setNotice({ kind: "success", message: "个人画像已保存。" });
      onSaved(updated);
    } catch (error: unknown) {
      if (
        error instanceof ApiRequestError &&
        (error.message === "USER_PROFILE_VERSION_CONFLICT" ||
          (error as { code?: string }).code === "USER_PROFILE_VERSION_CONFLICT")
      ) {
        const conflictPayload = error.payload as { profile?: UserProfileData } | null;
        const latestProfile = conflictPayload?.profile;
        if (latestProfile) {
          onConflict(latestProfile);
          setForm(toFormState(latestProfile));
          setNotice({
            kind: "error",
            message: "数据已被其他写入方修改，已刷新为最新版本，请确认后重试。",
          });
        } else {
          setNotice({
            kind: "error",
            message: "数据版本冲突，请重新打开编辑窗口后保存。",
          });
        }
      } else {
        setNotice({
          kind: "error",
          message: accountErrorMessage(error, "保存个人画像失败，请重试。"),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="account-profile-edit-dialog">
        <DialogHeader className="account-profile-edit-header">
          <DialogTitle>编辑个人画像</DialogTitle>
          <DialogDescription>
            完善求职条件与个人信息，信息将跨简历同步共享。
          </DialogDescription>
        </DialogHeader>

        <div className="account-profile-edit-tabs" role="tablist" aria-label="画像分类">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "preferences"}
            className={`account-profile-edit-tab ${activeTab === "preferences" ? "account-profile-edit-tab-active" : ""}`}
            onClick={() => setActiveTab("preferences")}
          >
            <Briefcase size={15} aria-hidden />
            求职意向
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "education"}
            className={`account-profile-edit-tab ${activeTab === "education" ? "account-profile-edit-tab-active" : ""}`}
            onClick={() => setActiveTab("education")}
          >
            <GraduationCap size={15} aria-hidden />
            教育与背景
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "skills"}
            className={`account-profile-edit-tab ${activeTab === "skills" ? "account-profile-edit-tab-active" : ""}`}
            onClick={() => setActiveTab("skills")}
          >
            <Award size={15} aria-hidden />
            技能与亮点
          </button>
        </div>

        <div className="account-profile-edit-body">
          {activeTab === "preferences" && (
            <div className="account-profile-edit-tab-pane">
              <div className="account-profile-edit-form-grid">
                <div className="account-profile-edit-form-field-span account-profile-preference-columns">
                  <TagInput
                    label="可接受工作城市"
                    hint="输入后按 Enter 或逗号添加"
                    tags={form.candidate_cities}
                    placeholder="如：北京、上海、杭州"
                    ariaLabel="如：北京、上海、杭州"
                    onChange={(tags) => updateField("candidate_cities", tags)}
                  />

                  <div className="account-profile-edit-choice-field account-profile-employment-field">
                    <Label className="account-profile-field-label account-profile-employment-label">
                      <span>工作性质</span>
                      <span className="account-profile-employment-hint">可多选</span>
                    </Label>
                    <div className="account-profile-pill-group account-profile-employment-options">
                      {EMPLOYMENT_TYPE_OPTIONS.map((option) => (
                        <TogglePill
                          key={option.value}
                          active={form.employment_types.includes(option.value)}
                          className="account-profile-employment-option"
                          icon={
                            <Check
                              size={14}
                              aria-hidden
                              className={
                                form.employment_types.includes(option.value)
                                  ? ""
                                  : "account-profile-multi-check-hidden"
                              }
                            />
                          }
                          onClick={() => toggleEmploymentType(option.value)}
                          aria-label={option.label}
                        >
                          {option.label}
                        </TogglePill>
                      ))}
                    </div>
                  </div>

                  <ProfileSelectField
                    label="工作经验"
                    value={form.candidate_status}
                    placeholder="请选择工作经验"
                    options={CANDIDATE_STATUS_OPTIONS}
                    onChange={(value) =>
                      selectCandidateStatus(value as CandidateStatus)
                    }
                  />

                  <div className="account-profile-experience-detail">
                    {form.candidate_status === "fresh_graduate" ? (
                      <ProfileNumberField
                        min={1900}
                        max={9999}
                        label="毕业年份"
                        value={form.graduation_year}
                        placeholder="例如：2026"
                        ariaLabel="毕业年份"
                        onChange={(value) =>
                          updateField("graduation_year", value == null ? null : Math.trunc(value))
                        }
                      />
                    ) : form.candidate_status === "experienced" ? (
                      <ProfileNumberField
                        min={0}
                        max={60}
                        label="工作年限（年）"
                        value={form.years_experience}
                        placeholder="例如：3"
                        ariaLabel="工作年限"
                        onChange={(value) =>
                          updateField("years_experience", value == null ? null : Math.trunc(value))
                        }
                      />
                    ) : null}
                  </div>
                </div>

                <div className="account-profile-edit-form-field-span account-profile-salary-section">
                  <div className="account-profile-salary-heading">
                    <Label className="account-profile-field-label">期望薪资</Label>
                  </div>
                  <div className="account-profile-salary-grid">
                    <ProfileNumberField
                      min={0}
                      step={1000}
                      label="最低薪资"
                      value={form.salary_min}
                      placeholder="例如：15000"
                      ariaLabel="最低薪资"
                      onChange={(value) => updateField("salary_min", value)}
                    />
                    <ProfileNumberField
                      min={0}
                      step={1000}
                      label="最高薪资"
                      value={form.salary_max}
                      placeholder="例如：25000"
                      ariaLabel="最高薪资"
                      onChange={(value) => updateField("salary_max", value)}
                    />
                    <TextField
                      label="币种"
                      value={form.salary_currency ?? "CNY"}
                      placeholder="例如：CNY"
                      maxLength={3}
                      aria-label="薪资币种"
                      onChange={(event) =>
                        updateField(
                          "salary_currency",
                          event.target.value.toUpperCase().trim() || null,
                        )
                      }
                    />
                    <ProfileSelectField
                      label="计薪周期"
                      value={form.salary_period ?? "month"}
                      placeholder="计薪周期"
                      options={SALARY_PERIOD_OPTIONS}
                      onChange={(value) =>
                        updateField("salary_period", (value as SalaryPeriod) || "month")
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "education" && (
            <div className="account-profile-edit-tab-pane">
              <div className="account-profile-edit-form-grid">
                <TextField
                  label="毕业院校"
                  value={form.school ?? ""}
                  placeholder="例如：北京大学"
                  maxLength={255}
                  aria-label="毕业院校"
                  onChange={(event) =>
                    updateField("school", event.target.value.trim() || null)
                  }
                />
                <TextField
                  label="专业方向"
                  value={form.major ?? ""}
                  placeholder="例如：计算机科学与技术"
                  maxLength={100}
                  aria-label="专业方向"
                  onChange={(event) =>
                    updateField("major", event.target.value.trim() || null)
                  }
                />
                <ProfileSelectField
                  label="学历层次"
                  value={form.education_level}
                  placeholder="请选择学历层次"
                  options={[
                    { label: "未指定", value: "" },
                    ...EDUCATION_LEVEL_OPTIONS,
                  ]}
                  onChange={(value) =>
                    updateField("education_level", (value as EducationLevel) || null)
                  }
                />
                <div className="account-profile-edit-choice-field account-profile-school-tier-field">
                  <Label className="account-profile-field-label account-profile-school-tier-label">
                    <span>学校标签</span>
                    <span className="account-profile-school-tier-hint">可多选</span>
                  </Label>
                  <div className="account-profile-pill-group account-profile-school-tier-options">
                    {SCHOOL_TIER_OPTIONS.map((option) => (
                      <TogglePill
                        key={option.value}
                        active={form.school_tier.includes(option.value)}
                        className="account-profile-school-tier-option"
                        icon={
                          <Check
                            size={14}
                            aria-hidden
                            className={
                              form.school_tier.includes(option.value)
                                ? ""
                                : "account-profile-multi-check-hidden"
                            }
                          />
                        }
                        onClick={() => toggleSchoolTier(option.value)}
                        aria-label={option.label}
                      >
                        {option.label}
                      </TogglePill>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "skills" && (
            <div className="account-profile-edit-tab-pane">
              <div className="account-profile-edit-form-grid">
                <TagInput
                  label="专业技能"
                  hint="个人技术栈或业务专长"
                  tags={form.skills}
                  placeholder="如：React、TypeScript、FastAPI、MySQL"
                  ariaLabel="如：React、TypeScript、FastAPI、MySQL、Docker"
                  onChange={(tags) => updateField("skills", tags)}
                />
                <TagInput
                  label="语言能力"
                  hint="外语水平与证书等级"
                  tags={form.languages}
                  placeholder="如：英语 CET-6、日语 N1"
                  ariaLabel="如：英语 CET-6（熟练）、日语 N1"
                  onChange={(tags) => updateField("languages", tags)}
                />
                <TagInput
                  label="专业证书"
                  hint="行业资格认证"
                  tags={form.certifications}
                  placeholder="如：PMP、AWS 认证架构师"
                  ariaLabel="如：PMP 项目管理专业人士、AWS 解决方案架构师"
                  onChange={(tags) => updateField("certifications", tags)}
                />
                <TagInput
                  label="荣誉奖项"
                  hint="比赛获奖、优秀表彰"
                  tags={form.honors}
                  placeholder="如：国家奖学金、年度优秀员工"
                  ariaLabel="如：国家奖学金、ACM-ICPC 区域赛银奖、年度优秀员工"
                  onChange={(tags) => updateField("honors", tags)}
                />
                <div className="account-profile-edit-form-field-span">
                  <TagInput
                    label="校园经历"
                    hint="社团、学生会、竞赛实践等"
                    tags={form.campus_experiences}
                    placeholder="如：学生会主席、开源社团核心成员"
                    ariaLabel="如：学生会主席、开源社团核心成员"
                    onChange={(tags) => updateField("campus_experiences", tags)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="account-profile-edit-footer">
          {notice && <FeedbackNotice kind={notice.kind}>{notice.message}</FeedbackNotice>}
          <div className="account-profile-edit-footer-actions">
            <Button
              variant="outline"
              disabled={saving}
              className="account-profile-dialog-cancel-btn"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button variant="default" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "保存中…" : "保存画像"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

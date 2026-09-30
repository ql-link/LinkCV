import { MotionPresence, useContentMotion } from "@/components/ui/motion";
import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiRequestError, type JobDescriptionCreatePayload, type JobDescriptionDraft, type JobDuplicateDetails } from "../../api/client";
import { FeedbackNotice, FileUpload } from "@/components/ui";
import { Icon, type V3IconName } from "@/v3/Icon";
import { Dialog, DialogFooter, Select } from "@/v3/primitives";
import { Badge, Bar, Centered, DashArrow, Paper } from "@/v3/art";
import { careerApplicationPath, jobDetailPath, navigateTo } from "../../routing";
import { JobDuplicateDialog } from "./JobDuplicateDialog";
import { duplicateFromJobError, emptyJobForm, jobFormErrorMessage, jobFormFromDraft, jobFormMissingFields, jobPayloadFromForm, type JobFormState } from "./jobFormModel";
import "./jobs.css";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
type ImportTab = "manual" | "text" | "image";

// 04.1a 导入岗位（640×780）：粘贴文字 / 上传截图 / 手工填写三种方式 → 识别中 → 核对 → 创建。
// 业务流程不变：parseJobDescriptionDraft 识别草稿，createJobDescription 保存岗位并放进看板「待投递」，重复来源走 JobDuplicateDialog。
export function JobSmartImportDialog({ onClose, onParsed, onInstallPlugin, unified = false }: {
  onClose: () => void;
  onParsed?: (draft: JobDescriptionDraft, warnings: string[]) => void;
  onInstallPlugin?: () => void;
  unified?: boolean;
}) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState<ImportTab>("text");
  const [form, setForm] = useState<JobFormState>(emptyJobForm);
  const [warnings, setWarnings] = useState<string[]>([]);
  // 识别完成后进入「核对」步骤：记录来源，未识别的字段用橙色虚线标出
  const [reviewSource, setReviewSource] = useState<"text" | "image" | null>(null);
  const bodyMotionRef = useContentMotion<HTMLDivElement>(`${activeTab}:${reviewSource}`);
  const [recognizedFields, setRecognizedFields] = useState<Set<keyof JobFormState>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [duplicate, setDuplicate] = useState<JobDuplicateDetails["duplicate"] | null>(null);
  const [pendingPayload, setPendingPayload] = useState<JobDescriptionCreatePayload | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const previewUrl = useMemo(() => image ? URL.createObjectURL(image) : "", [image]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => requestRef.current?.abort(), []);

  // 在弹窗任意位置粘贴截图都能切到「上传截图」。Dialog 基础件不转发 onPaste，所以在 document 上监听、只处理弹窗内的粘贴
  const formRef = useRef<HTMLFormElement>(null);
  const pasteStateRef = useRef({ busy, activeTab });
  pasteStateRef.current = { busy, activeTab };
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const dialog = formRef.current?.closest("[role='dialog']");
      if (!dialog || !(event.target instanceof Node) || !dialog.contains(event.target)) return;
      const { busy: currentBusy, activeTab: currentTab } = pasteStateRef.current;
      if (currentBusy || currentTab === "manual") return;
      const pastedImage = Array.from(event.clipboardData?.items ?? []).find((item) => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
      if (pastedImage) { event.preventDefault(); chooseImageRef.current(pastedImage); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const close = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    onClose();
  };

  const setField = <K extends keyof JobFormState>(field: K, value: JobFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  };

  const chooseImage = (file: File | undefined) => {
    if (!file) return;
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      setError("仅支持 PNG、JPEG 或 WebP 图片。");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("图片不能超过 10 MiB。");
      return;
    }
    setImage(file);
    setActiveTab("image");
    setError("");
  };

  const chooseImageRef = useRef(chooseImage);
  chooseImageRef.current = chooseImage;

  const selectTab = (tab: ImportTab) => {
    if (busy) return;
    setActiveTab(tab);
    if (tab !== "manual") setReviewSource(null);
    setError("");
  };

  const parseImport = async () => {
    const normalizedText = text.trim();
    const inputType = activeTab === "image" ? "image" : "text";
    if (activeTab === "image" && !image) return setError("请上传岗位截图。");
    if (activeTab === "text" && !normalizedText) return setError("请输入岗位文字。");
    if (activeTab === "text" && normalizedText.length > 60_000) return setError("岗位文字不能超过 60000 个字符。");
    setBusy(true);
    setError("");
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const result = await api.parseJobDescriptionDraft(activeTab === "image"
        ? { image: image as File, signal: controller.signal }
        : { text: normalizedText, signal: controller.signal });
      if (!controller.signal.aborted && requestRef.current === controller) {
        if (unified) {
          const nextForm = jobFormFromDraft(result.draft);
          setForm(nextForm);
          setWarnings(result.warnings);
          setRecognizedFields(new Set((Object.keys(nextForm) as Array<keyof JobFormState>).filter((key) => String(nextForm[key] ?? "").trim())));
          setReviewSource(inputType);
          setActiveTab("manual");
        } else {
          onParsed?.(result.draft, result.warnings);
        }
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(importErrorMessage(caught, inputType));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  };

  const createJob = async () => {
    const missing = jobFormMissingFields(form);
    if (missing.length > 0) return setError(`请先填写${missing.join("、")}`);
    setBusy(true);
    setError("");
    const payload = jobPayloadFromForm(form);
    setPendingPayload(payload);
    try {
      const { job_description, application } = await api.createJobDescription(payload);
      onClose();
      navigateTo(
        application
          ? careerApplicationPath(application.id)
          : jobDetailPath(job_description.id),
        { replace: true },
      );
    } catch (caught) {
      const duplicateDetails = duplicateFromJobError(caught);
      if (duplicateDetails) setDuplicate(duplicateDetails);
      else setError(jobFormErrorMessage(caught, "保存岗位失败，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  };

  const resolveDuplicate = async (action: "update" | "cancel") => {
    if (action === "cancel") return setDuplicate(null);
    if (!duplicate || !pendingPayload || busy) return;
    setBusy(true);
    setError("");
    try {
      const { job_description, application } = await api.createJobDescription({
        ...pendingPayload,
        duplicate_resolution: { action, job_description_id: duplicate.existing.id, base_lock_version: duplicate.existing.lock_version },
      });
      onClose();
      navigateTo(
        application
          ? careerApplicationPath(application.id)
          : jobDetailPath(job_description.id),
        { replace: true },
      );
    } catch (caught) {
      setDuplicate(null);
      setError(jobFormErrorMessage(caught, "重复岗位内容已经变化，请刷新后重试。"));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) void (activeTab === "manual" ? createJob() : parseImport());
  };

  const title = unified ? "导入岗位" : "智能填写岗位信息";
  const description = unified ? "三种方式都会先生成岗位草稿，核对无误后保存岗位，并放进看板「待投递」。" : "提供招聘内容，生成一份可继续修改的岗位草稿。";
  const reviewing = activeTab === "manual" && reviewSource !== null;
  // 右上角步骤：提供信息 → 核对 → 创建（手工填写直接在第 1 步创建）
  const step = reviewing ? 2 : 1;
  const primaryLabel = busy
    ? activeTab === "manual" ? "正在创建…" : "正在识别…"
    : activeTab === "manual" ? "创建岗位" : unified ? "确认导入" : "开始识别";
  const missing = (field: keyof JobFormState) => reviewing && !recognizedFields.has(field) && !String(form[field] ?? "").trim();
  const toggleGroup = (group: string) => setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    return next;
  });

  return (
    <Dialog width={640} label={title} onClose={close} className="job-import-dialog job-smart-import-dialog">
      <form ref={formRef} className="job-import-form" onSubmit={submit}>
        <div ref={bodyMotionRef} className="v3-dialog-body job-import-body">
          <div className="job-import-head">
            <div>
              <h2 className="v3-dialog-title job-smart-title">{title}</h2>
              <p className="v3-dialog-sub">{description}</p>
            </div>
            <ol className="job-import-steps" aria-label="导入步骤">
              {["提供信息", "核对", "创建"].map((label, index) => {
                const number = index + 1;
                const state = number < step ? "done" : number === step ? "current" : "todo";
                return (
                  <li key={label} className={`is-${state}`} aria-current={state === "current" ? "step" : undefined}>
                    <span className="job-import-step-dot v3-num">{state === "done" ? <Icon name="check" size={12} /> : number}</span>
                    {label}
                  </li>
                );
              })}
            </ol>
          </div>
          {!reviewing && (
            <>
              <p className="job-import-label">导入方式</p>
              <div className="job-import-tiles" role="tablist" aria-label="岗位导入方式">
                <ImportTabButton tab="text" icon="text" activeTab={activeTab} busy={busy} onSelect={selectTab}>粘贴岗位文字</ImportTabButton>
                <ImportTabButton tab="image" icon="image" activeTab={activeTab} busy={busy} onSelect={selectTab}>上传岗位截图</ImportTabButton>
                <ImportTabButton tab="manual" icon="edit" activeTab={activeTab} busy={busy} onSelect={selectTab}>手工填写</ImportTabButton>
              </div>
            </>
          )}
          {reviewing && (
            <>
              {/* 核对页：顶部摘要卡说明识别了几项、哪些没识别 */}
              <div className="job-import-summary">
                <Badge x={18} y={27} icon="check" fill="var(--v3-gn)" />
                <div>
                  <strong>已从{reviewSource === "image" ? "岗位截图" : "岗位文字"}识别出 {recognizedFields.size} 个字段</strong>
                  <p>没有识别到的已用橙色标出。可以现在补充，也可以之后在岗位详情里修改。</p>
                </div>
                <button type="button" className="v3-link" onClick={() => selectTab(reviewSource === "image" ? "image" : "text")}>查看原文</button>
              </div>
              {/* 兼容原有的「手工填写」tab 语义：核对页仍然属于这个页签 */}
              <div className="v3-visually-hidden" role="tablist" aria-label="岗位导入方式">
                <ImportTabButton tab="text" icon="text" activeTab={activeTab} busy={busy} onSelect={selectTab}>粘贴岗位文字</ImportTabButton>
                <ImportTabButton tab="image" icon="image" activeTab={activeTab} busy={busy} onSelect={selectTab}>上传岗位截图</ImportTabButton>
                <ImportTabButton tab="manual" icon="edit" activeTab={activeTab} busy={busy} onSelect={selectTab}>手工填写</ImportTabButton>
              </div>
            </>
          )}

          {activeTab === "text" && <div id="job-smart-panel-text" className="job-smart-panel job-smart-source-panel" role="tabpanel" aria-labelledby="job-smart-tab-text">
            <div className="v3-stage has-dots job-import-stage"><PasteArt /></div>
            <label className="job-import-field-label" htmlFor="job-smart-job-info"><span>岗位文字</span><small className="v3-num">{text.length.toLocaleString("zh-CN")} / 60000</small></label>
            <textarea className={`v3-textarea job-import-textarea${busy ? " is-busy" : ""}`} id="job-smart-job-info" aria-label="岗位文字" name="job-source-text" autoComplete="off" value={text} disabled={busy} maxLength={60_001} placeholder="粘贴职位名称、岗位职责、任职要求、薪资和公司信息…" onChange={(event) => { setText(event.target.value); setError(""); }} />
            {busy ? <ParsingProgress /> : <p className="job-smart-hint">系统只提取岗位核心信息，创建后仍可在求职记录中修改。</p>}
          </div>}

          {activeTab === "image" && <div id="job-smart-panel-image" className="job-smart-panel job-smart-source-panel" role="tabpanel" aria-labelledby="job-smart-tab-image">
            <div className="v3-stage has-dots job-import-stage"><ShotArt /></div>
            <p className="job-import-field-label"><span>岗位截图</span><small>PNG、JPEG 或 WebP · 最大 10 MB · 每次一张</small></p>
            {image ? <div className="job-smart-image-preview job-import-dropzone is-filled">
              <img src={previewUrl} alt="待识别岗位截图预览" width="116" height="96" />
              <div><Icon name="image" size={16} /><span><strong>{image.name}</strong><small>{formatBytes(image.size)}</small></span></div>
              <button type="button" className="v3-btn v3-btn-ghost is-sm" disabled={busy} onClick={() => { setImage(null); setError(""); }}>移除图片</button>
            </div> : <FileUpload icon={<Icon name="image" size={16} />} className="job-smart-image-upload job-import-dropzone" accept="image/png,image/jpeg,image/webp" inputLabel="选择岗位截图" supportingText="点击此区域上传岗位截图，也可拖放或直接粘贴截图（⌘V）。" browseLabel="" disabled={busy} onFileSelect={chooseImage} />}
            {busy ? <ParsingProgress /> : (
              <ul className="job-import-tips">
                <li><Icon name="check" size={12} />截图里要有职位名称和公司，这两项必填</li>
                <li><Icon name="check" size={12} />一屏放不下就截最关键的一屏，其余在核对时补</li>
              </ul>
            )}
            <small className="job-smart-image-meta v3-visually-hidden">PNG、JPEG 或 WebP · 最大 10 MiB</small>
            <p className="job-smart-hint v3-visually-hidden">系统只提取岗位核心信息，创建后仍可在求职记录中修改。</p>
          </div>}

          {activeTab === "manual" && <div id="job-smart-panel-manual" className="job-smart-panel job-smart-manual-panel" role="tabpanel" aria-labelledby="job-smart-tab-manual">
            {!reviewing && <div className="v3-stage has-dots job-import-stage"><ManualArt /></div>}
            {warnings.length > 0 && <p className="job-smart-warning" role="status">{warnings.join(" ")}</p>}
            <div className="job-smart-manual-sections">
              <ManualSection title="基本信息" open>
                <CompactInput label="职位名称" placeholder="例如：后端开发工程师" required value={form.job_title} maxLength={200} missing={missing("job_title")} onChange={(value) => setField("job_title", value)} />
                <CompactInput label="公司名称" placeholder="例如：字节跳动" required value={form.company_name} maxLength={200} missing={missing("company_name")} onChange={(value) => setField("company_name", value)} />
                <CompactInput label="薪资范围" placeholder="例如：25-40K，或面议" value={form.salary_text} missing={missing("salary_text")} onChange={(value) => setField("salary_text", value)} />
                <CompactInput className="is-wide" label="工作城市" icon="pin" placeholder="例如：北京" value={form.work_city} missing={missing("work_city")} onChange={(value) => setField("work_city", value)} />
                <CompactSelect label="求职分类" value={form.employment_type} missing={missing("employment_type")} onChange={(value) => setField("employment_type", value as JobFormState["employment_type"])} options={[
                  ["internship", "实习"], ["campus", "校招"], ["full_time", "正式"],
                ]} />
              </ManualSection>
              <p className="job-import-more-label"><span>{reviewing ? "其余信息" : "更多信息"}</span><small>可选，之后在岗位详情也能改</small></p>
              <div className="job-import-more-chips">
                {[
                  ["requirements", reviewing ? `职位描述 · ${form.description.trim() ? "已识别" : "未识别"}` : "任职要求"],
                  ["work", "工作安排"],
                  ["company", "公司与联系人"],
                  ["source", "来源与备注"],
                ].map(([key, label]) => (
                  <button key={key} type="button" className="job-import-chip" aria-expanded={expandedGroups.has(key)} onClick={() => toggleGroup(key)}>
                    <Icon name={expandedGroups.has(key) ? "minus" : "plus"} size={12} />{label}
                  </button>
                ))}
              </div>
              {/* 其余分组默认折叠（设计稿用「+ 补充」胶囊），展开后是同样的两列字段；隐藏时仍保留在 DOM 里，方便键盘和辅助技术定位 */}
              <ManualSection title="任职要求" hidden={!expandedGroups.has("requirements")}>
                <CompactTextarea className="is-wide" label="职位描述" placeholder="填写岗位职责、工作内容和任职要求（可选）" value={form.description} onChange={(value) => setField("description", value)} />
                <CompactInput label="技能" placeholder="使用逗号或换行分隔，例如：Java、SQL" value={form.skills} onChange={(value) => setField("skills", value)} />
                <CompactInput label="学历要求" placeholder="例如：本科及以上" value={form.education_requirement} onChange={(value) => setField("education_requirement", value)} />
                <CompactInput label="经验要求" placeholder="例如：3-5年" value={form.experience_requirement} onChange={(value) => setField("experience_requirement", value)} />
              </ManualSection>
              <ManualSection title="工作与薪酬" hidden={!expandedGroups.has("work")}>
                <CompactInput label="详细地址" placeholder="填写办公地点或详细地址" value={form.work_address} onChange={(value) => setField("work_address", value)} />
                <CompactSelect label="工作方式" value={form.work_mode} missing={missing("work_mode")} onChange={(value) => setField("work_mode", value as JobFormState["work_mode"])} options={[
                  ["onsite", "现场"], ["hybrid", "混合"], ["remote", "远程"],
                ]} />
                <CompactInput label="工作安排" placeholder="例如：双休、弹性打卡" value={form.work_schedule} onChange={(value) => setField("work_schedule", value)} />
              </ManualSection>
              <ManualSection title="公司与联系人" hidden={!expandedGroups.has("company")}>
                <CompactInput label="行业" placeholder="例如：互联网、金融" value={form.company_industry} onChange={(value) => setField("company_industry", value)} />
                <CompactInput label="公司规模" placeholder="例如：100-499人" value={form.company_size} onChange={(value) => setField("company_size", value)} />
                <CompactInput label="融资阶段" placeholder="例如：A轮、上市公司" value={form.company_financing_stage} onChange={(value) => setField("company_financing_stage", value)} />
                <CompactInput label="招聘者姓名" placeholder="填写联系人姓名" value={form.recruiter_name} onChange={(value) => setField("recruiter_name", value)} />
                <CompactInput label="招聘者职位" placeholder="填写联系人职位" value={form.recruiter_title} onChange={(value) => setField("recruiter_title", value)} />
                <CompactInput className="is-wide" label="公司 Logo URL（可选）" placeholder="填写公开可访问的 HTTPS 图片地址" type="url" value={form.logo_url} maxLength={2048} onChange={(value) => setField("logo_url", value)} />
              </ManualSection>
              <ManualSection title="来源与备注" hidden={!expandedGroups.has("source")}>
                <CompactInput className="is-wide" label="来源链接（可选）" icon="link" placeholder="粘贴岗位原始链接" type="url" value={form.source_url} onChange={(value) => setField("source_url", value)} />
                <CompactTextarea className="is-wide" label="个人备注" placeholder="填写你对这个岗位的补充备注" value={form.notes} onChange={(value) => setField("notes", value)} />
              </ManualSection>
            </div>
          </div>}
          {error && (
            <FeedbackNotice kind="error" placement="floating" onDismiss={() => setError("")}>
              {error}
            </FeedbackNotice>
          )}
        </div>
        <DialogFooter left={reviewing ? (
          <button type="button" className="v3-link" disabled={busy} onClick={() => selectTab(reviewSource === "image" ? "image" : "text")}><Icon name="chevl" size={13} />返回修改原文</button>
        ) : busy && activeTab !== "manual" ? (
          <span className="job-import-foot-note">关闭弹窗会取消识别</span>
        ) : unified && onInstallPlugin ? (
          <button type="button" className="v3-link" onClick={onInstallPlugin}>常在招聘网站看岗位？用浏览器插件一键保存<Icon name="arrow" size={12} /></button>
        ) : undefined}>
          {!reviewing && <button type="button" className="v3-btn v3-btn-ghost job-import-cancel" onClick={close}>取消</button>}
          <button type="submit" className="v3-btn v3-btn-dark" disabled={busy} aria-busy={busy}>{primaryLabel}</button>
        </DialogFooter>
      </form>
      <MotionPresence>{duplicate && <JobDuplicateDialog details={duplicate} busy={busy} onAction={resolveDuplicate} />}</MotionPresence>
    </Dialog>
  );
}

function ImportTabButton({ tab, icon, activeTab, busy, onSelect, children }: { tab: ImportTab; icon: V3IconName; activeTab: ImportTab; busy: boolean; onSelect: (tab: ImportTab) => void; children: ReactNode }) {
  const selected = activeTab === tab;
  return (
    <button id={`job-smart-tab-${tab}`} type="button" role="tab" aria-selected={selected} aria-controls={`job-smart-panel-${tab}`} className={`job-smart-tab job-import-tile${selected ? " is-selected" : ""}`} disabled={busy} onClick={() => onSelect(tab)}>
      <Icon name={icon} size={16} />
      <span>{children}</span>
      {selected && <span className="job-import-tile-check" aria-hidden="true"><Icon name="check" size={10} strokeWidth={2.4} /></span>}
    </button>
  );
}

function ManualSection({ title, open = false, hidden = false, children }: { title: string; open?: boolean; hidden?: boolean; children: ReactNode }) {
  // 标题只给辅助技术读（设计稿里分组没有可见标题，只有「+ 补充」胶囊）
  return (
    <section className={`job-smart-manual-section${hidden ? " is-collapsed" : ""}${open ? " is-open" : ""}`} aria-label={title}>
      <h3 className="v3-visually-hidden">{title}</h3>
      <div className="job-smart-manual-grid">{children}</div>
    </section>
  );
}

function CompactInput({ label, className = "", required, icon, missing = false, onChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & { label: string; className?: string; icon?: V3IconName; missing?: boolean; onChange: (value: string) => void }) {
  const id = `job-import-${label}`;
  return (
    <div className={`job-smart-manual-field ${className}`.trim()}>
      <label className="job-import-field-label" htmlFor={id}><span>{label}{required && <em aria-hidden="true">*</em>}</span>{missing && <small>未识别</small>}</label>
      <span className={`job-import-input${icon ? " has-icon" : ""}${missing ? " is-missing" : ""}`}>
        {icon && <Icon name={icon} size={14} />}
        <input {...props} className="v3-input" id={id} required={required} aria-label={label} autoComplete="off" placeholder={missing ? "可以现在补充，也可以之后改" : props.placeholder} onChange={(event) => onChange(event.target.value)} />
      </span>
    </div>
  );
}

function CompactTextarea({ label, className = "", required, value, placeholder, onChange }: { label: string; className?: string; required?: boolean; value: string; placeholder?: string; onChange: (value: string) => void }) {
  const id = `job-import-${label}`;
  return (
    <div className={`job-smart-manual-field ${className}`.trim()}>
      <label className="job-import-field-label" htmlFor={id}><span>{label}{required && <em aria-hidden="true">*</em>}</span></label>
      <textarea className="v3-textarea" id={id} required={required} aria-label={label} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

// 求职分类、工作方式：设计稿用分段切换（实习 / 校招 / 正式），可以再点一次取消选择
function CompactSelect({ label, value, options, missing = false, onChange }: { label: string; value: string; options: Array<[string, string]>; missing?: boolean; onChange: (value: string) => void }) {
  const id = `job-import-${label}`;
  return (
    <div className="job-smart-manual-field">
      <span className="job-import-field-label" id={`${id}-label`}><span>{label}</span>{missing && <small>未识别</small>}</span>
      <Select
        id={id}
        label={label}
        size="sm"
        value={value}
        placeholder="未填写"
        options={[{ value: "", label: "未填写" }, ...options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel }))]}
        onChange={onChange}
      />
    </div>
  );
}

// 识别中：进度条 + 预计时间
function ParsingProgress() {
  return (
    <div className="job-import-progress" role="status" aria-label="正在识别">
      <p><span>正在提取职位、公司、薪资和任职要求</span><small className="v3-num">约 5 秒</small></p>
      <span className="job-import-progress-track"><span /></span>
    </div>
  );
}

/* ─────────── 插图（设计稿 p06a.js：pasteA / shotA / manualA，舞台 576×120） ─────────── */

function FieldsCard() {
  return (
    <Paper x={176} y={18} w={116} h={88}>
      {["职位", "公司", "薪资"].map((label, index) => (
        <span key={label}>
          <span style={{ position: "absolute", left: 10, top: 12 + index * 24, color: "var(--v3-fnt)", fontSize: 8.5, fontWeight: 500 }}>{label}</span>
          <Bar x={36} y={16 + index * 24} w={[44, 30, 36][index]} h={5} color="var(--v3-dark)" r={2} />
          <span style={{ position: "absolute", left: 92, top: 12 + index * 24, display: "grid", width: 14, height: 14, placeItems: "center", borderRadius: 7, background: "var(--v3-gn-soft)", color: "var(--v3-gn)" }}><Icon name="check" size={10} /></span>
        </span>
      ))}
    </Paper>
  );
}

function StageCaption({ title, body }: { title: string; body: string }) {
  return (
    <span style={{ position: "absolute", left: 316, top: 30, width: 240 }}>
      <strong style={{ display: "block", color: "var(--v3-txt)", fontSize: 13, fontWeight: 500 }}>{title}</strong>
      <small style={{ display: "block", marginTop: 8, color: "var(--v3-sub)", fontSize: 11.5, lineHeight: "19px" }}>{body}</small>
    </span>
  );
}

function PasteArt() {
  return (
    <Centered width={576} height={120}>
      <Paper x={28} y={18} w={96} h={90}>
        <Bar x={6} y={36} w={84} h={20} color="var(--v3-hl)" r={3} />
        <Bar x={10} y={16} w={50} h={5} color="var(--v3-dark)" r={2} />
        {[26, 34, 42, 50, 58, 66, 74].map((top, index) => <Bar key={top} x={10} y={top} w={[76, 70, 60, 76, 52, 68, 40][index]} h={3} r={1} />)}
      </Paper>
      <Bar x={58} y={12} w={36} h={12} color="var(--v3-dark)" r={4} />
      <DashArrow x={134} y={56} w={34} />
      <FieldsCard />
      <Badge x={276} y={8} icon="spark" />
      <StageCaption title="适合网页上能复制文字的岗位" body="把职位名称、职责、要求和薪资一起粘贴进来，识别得更完整。" />
    </Centered>
  );
}

function ShotArt() {
  return (
    <Centered width={576} height={120}>
      <Paper x={44} y={14} w={60} h={94} r={9}>
        <Bar x={22} y={5} w={16} h={3} r={2} />
        <Bar x={8} y={16} w={30} h={5} color="var(--v3-dark)" r={2} />
        <Bar x={8} y={25} w={20} h={3} color="var(--v3-sk2)" r={1} />
        <Bar x={8} y={33} w={26} h={9} color="var(--v3-or-soft)" r={3} />
        {[48, 55, 62, 69, 76].map((top, index) => <Bar key={top} x={8} y={top} w={[44, 40, 44, 30, 38][index]} h={3} r={1} />)}
      </Paper>
      {/* 蓝色取景框四角 + 扫描线 */}
      {[[38, 8, "M1 11V1h10"], [98, 8, "M1 1h10v10"], [38, 102, "M1 1v10h10"], [98, 102, "M11 1v10H1"]].map(([left, top, d]) => (
        <svg key={String(d)} aria-hidden="true" style={{ position: "absolute", left: Number(left), top: Number(top) }} width="12" height="12" viewBox="0 0 12 12" fill="none"><path d={String(d)} stroke="var(--v3-bl)" strokeWidth="1.6" strokeLinecap="round" /></svg>
      ))}
      <Bar x={40} y={52} w={68} h={16} color="rgb(63 111 216 / 8%)" r={2} />
      <Bar x={40} y={67} w={68} h={2} color="rgb(63 111 216 / 60%)" r={1} />
      <DashArrow x={122} y={56} w={40} />
      <FieldsCard />
      <Badge x={276} y={8} icon="spark" />
      <StageCaption title="适合 App 里不能复制的岗位" body="截一张包含职位名称和岗位要求的图，识别后逐项核对。" />
    </Centered>
  );
}

function ManualArt() {
  const dashed = { position: "absolute" as const, border: "1px dashed var(--v3-fl)" };
  return (
    <Centered width={576} height={120}>
      <Paper x={40} y={20} w={156} h={84}>
        <span style={{ ...dashed, left: 12, top: 12, width: 26, height: 26, borderRadius: 6 }} />
        <span style={{ ...dashed, left: 48, top: 14, width: 70, height: 8, borderRadius: 3 }} />
        <span style={{ ...dashed, left: 48, top: 28, width: 46, height: 8, borderRadius: 3 }} />
        <span style={{ position: "absolute", left: 122, top: 10, color: "var(--v3-rd)", fontSize: 10, fontWeight: 700 }}>*</span>
        <span style={{ position: "absolute", left: 98, top: 24, color: "var(--v3-rd)", fontSize: 10, fontWeight: 700 }}>*</span>
        <span style={{ ...dashed, left: 12, top: 52, width: 40, height: 16, borderRadius: 4 }} />
        <span style={{ ...dashed, left: 58, top: 52, width: 48, height: 16, borderRadius: 4 }} />
        <span style={{ ...dashed, left: 112, top: 52, width: 32, height: 16, borderRadius: 4 }} />
      </Paper>
      <Badge x={184} y={12} icon="edit" />
      <span style={{ position: "absolute", left: 206, top: 70, display: "inline-flex", height: 24, alignItems: "center", gap: 4, border: "1px solid var(--v3-cl)", borderRadius: 12, background: "#fff", padding: "0 10px", color: "var(--v3-sub)", fontSize: 10.5, fontWeight: 500 }}><b style={{ color: "var(--v3-rd)" }}>*</b>2 项必填</span>
      <StageCaption title="适合内推、线下招聘的岗位" body="只需填写职位名称和公司，其余信息之后可以在岗位详情里随时补充。" />
    </Centered>
  );
}

function importErrorMessage(error: unknown, inputType: "text" | "image"): string {
  if (!(error instanceof ApiRequestError)) return "暂时无法识别，请稍后重试。";
  if (error.message === "JD_IMPORT_MODEL_NOT_CONFIGURED") return `${inputType === "image" ? "图片" : "文字"}解析模型尚未配置，请联系管理员或改为填写。`;
  if (error.message === "JD_IMPORT_PARSE_TIMEOUT") return "识别超时，请重试或改为填写。";
  if (error.message === "JD_IMPORT_IMAGE_TOO_LARGE") return "图片不能超过 10 MiB。";
  if (error.message === "JD_IMPORT_IMAGE_UNSUPPORTED") return "仅支持 PNG、JPEG 或 WebP 图片。";
  if (error.message === "JD_IMPORT_IMAGE_INVALID") return "无法读取这张图片，请更换后重试。";
  if (error.message === "JD_IMPORT_TEXT_TOO_LARGE") return "岗位文字不能超过 60000 个字符。";
  if (error.message === "JD_IMPORT_PARSE_FAILED") return `未能从${inputType === "image" ? "图片" : "文字"}中识别出有效岗位信息，请重试或改为填写。`;
  return "暂时无法识别，请稍后重试。";
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

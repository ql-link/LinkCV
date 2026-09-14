import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import {
  LinkResumeApiError,
  connectToLinkResume,
  importJob,
  linkResumeUrl,
  type LinkResumeConnection,
} from "../../src/api/linkresume";
import {
  CAPTURE_MESSAGE,
  type BossCaptureResult,
  type BossJobCapture,
  type DuplicateDetails,
  type DuplicateResolution,
  type JobImportResult,
} from "../../src/contracts";
import { isBossJobUrl } from "../../src/extractor/boss";
import { readBossLogo, saveCapturedCompanyLogo } from "../../src/api/company-logo";

type Phase = "loading" | "unavailable" | "login" | "capture-error" | "preview" | "submitting" | "duplicate" | "success";

const CONNECTING_MESSAGE = "正在连接 LinkResume 并读取当前页面…";
type View = "preview" | "edit" | "description";

interface ReadyCapture {
  sourceUrl: string;
  capture: BossJobCapture;
  warnings: string[];
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [connection, setConnection] = useState<LinkResumeConnection | null>(null);
  const [ready, setReady] = useState<ReadyCapture | null>(null);
  const [form, setForm] = useState<BossJobCapture | null>(null);
  const [view, setView] = useState<View>("preview");
  const [draft, setDraft] = useState<BossJobCapture | null>(null);
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState(CONNECTING_MESSAGE);
  const [duplicate, setDuplicate] = useState<DuplicateDetails | null>(null);
  const [created, setCreated] = useState<JobImportResult | null>(null);
  const [logoMessage, setLogoMessage] = useState("");

  const logo = useCompanyLogo(form?.logo_url);

  useEffect(() => { void initialize(); }, []);
  useEffect(() => { heading.current?.focus(); }, [view, phase]);

  async function initialize() {
    setPhase("loading");
    setMessage(CONNECTING_MESSAGE);
    setLogoMessage("");
    try {
      const [nextConnection, capture] = await Promise.all([
        connectToLinkResume(),
        captureActiveBossTab(),
      ]);
      setConnection(nextConnection);
      if (!nextConnection) {
        setPhase("unavailable");
        setMessage("无法连接 LinkResume，请确认对应环境已经启动。");
        return;
      }
      if (!nextConnection.user) {
        setPhase("login");
        setMessage("请先登录 LinkResume，再回来继续导入。");
        return;
      }
      if (!capture.ok) {
        setPhase("capture-error");
        setMessage(capture.message);
        return;
      }
      setReady(capture);
      setForm(capture.capture);
      setView("preview");
      setMessage("");
      setPhase("preview");
    } catch (error) {
      setPhase("capture-error");
      setMessage(captureErrorMessage(error));
    }
  }

  function updateField<K extends keyof BossJobCapture>(key: K, value: BossJobCapture[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function submit(resolution?: DuplicateResolution) {
    if (!connection || !ready || !form || submitting.current) return;
    if (!form.job_title?.trim() || !form.company_name?.trim() || !form.description_text?.trim()) {
      setMessage("岗位名称、公司名称和职位描述不能为空。");
      return;
    }
    submitting.current = true;
    setPhase("submitting");
    setMessage("正在整理并保存到 LinkResume…");
    try {
      const job = await importJob(connection.origin, {
        source_url: ready.sourceUrl,
        capture: form,
        duplicate_resolution: resolution,
      });
      setCreated(job);
      setDuplicate(null);
      setMessage("正在完成保存…");
      setLogoMessage(await saveCapturedCompanyLogo(connection.origin, job.job_description, form.logo_url));
      setMessage("");
      setPhase("success");
    } catch (error) {
      if (error instanceof LinkResumeApiError && error.code === "JD_SOURCE_DUPLICATE" && error.duplicate) {
        setDuplicate(error.duplicate);
        setPhase("duplicate");
        return;
      }
      if (error instanceof LinkResumeApiError && error.status === 401) {
        setPhase("login");
        setMessage("LinkResume 登录已失效，请重新登录后再试。");
        return;
      }
      setPhase("preview");
      setMessage(importErrorMessage(error));
    } finally {
      submitting.current = false;
    }
  }

  async function openLinkResume(path: string) {
    if (!connection) return;
    await browser.tabs.create({ url: linkResumeUrl(connection.origin, path) });
  }

  const header = (
    <header className="app-header">
      <div className="brand-lockup">
        <img className="mark" src="/linkresume-mark.png" alt="" aria-hidden="true" />
        <strong>LinkResume</strong>
      </div>

    </header>
  );

  if (phase === "loading" || phase === "submitting") {
    return <main>{header}<StatusView busy title={phase === "loading" ? "正在准备岗位" : "正在保存岗位"} message={message} /></main>;
  }

  if (phase === "unavailable") {
    return <main>{header}<StatusView title="无法连接 LinkResume" message={message} actionLabel="重试连接" onAction={() => void initialize()} /></main>;
  }

  if (phase === "login") {
    return (
      <main>
        {header}
        <StatusView
          title="需要登录"
          message={message}
          actionLabel="去登录"
          onAction={() => void openLinkResume("/login")}
          secondaryLabel="已登录，重新连接"
          onSecondary={() => void initialize()}
        />
      </main>
    );
  }

  if (phase === "capture-error") {
    return <main>{header}<StatusView title="无法读取岗位" message={message} actionLabel="重新读取" onAction={() => void initialize()} /></main>;
  }

  if (phase === "success" && created && form) {
    const job = created.job_description;
    const company = job.company_name || form.company_name || "";
    return (
      <main className="success-page">
        {header}
        <section className="success-content">
          <h1 className="success-heading" ref={heading} tabIndex={-1}>
            <svg className="success-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="m8 12 2.5 2.5L16 9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {created.application ? "岗位已加入求职记录" : "岗位已保存"}
          </h1>
          <div className="saved-job">
            <div className="job-identity">
              <CompanyLogo name={company} src={company === form.company_name ? logo : undefined} />
              <div className="job-names">
                <h2>{job.job_title || form.job_title}</h2>
                <p>{company}</p>
              </div>
            </div>
            {[form.salary_text, form.work_city, form.experience_text, form.education_text].some(Boolean) && (
              <div className="job-facts">
                {form.salary_text && <p className="salary">{form.salary_text}</p>}
                <p className="job-meta">{[form.work_city, form.experience_text, form.education_text].filter(Boolean).join("　/　")}</p>
              </div>
            )}
            {form.skills.length > 0 && <div className="skills">{form.skills.map((skill, index) => <span key={`${skill}-${index}`}>{skill}</span>)}</div>}
          </div>
          {logoMessage.includes("图标未保存") && <p className="notice" role="status">{logoMessage}</p>}
        </section>
        <footer className="success-footer">
          <button className="primary" type="button" onClick={() => void openLinkResume(created.application
            ? `/career/applications/${encodeURIComponent(created.application.id)}`
            : `/career/jobs/${encodeURIComponent(job.id)}`)}>
            {created.application ? "查看求职记录" : "查看岗位详情"}
          </button>
        </footer>
      </main>
    );
  }

  if (phase === "duplicate" && duplicate) {
    const resolution = (): DuplicateResolution => ({
      action: "update",
      job_description_id: duplicate.existing.id,
      base_lock_version: duplicate.existing.lock_version,
    });
    return (
      <main>
        {header}
        <section className="status-card compact">
          <span className="status-label">发现重复来源</span>
          <h1>{duplicate.existing.job_title}</h1>
          <p>{duplicate.existing.company_name} 已存在于你的 LinkResume。</p>
          <div className="actions vertical">
            {duplicate.allowed_actions.includes("update") && (
              <button className="primary" type="button" onClick={() => void submit(resolution())}>用本次内容更新</button>
            )}
            <button className="secondary" type="button" onClick={() => void openLinkResume(`/career/jobs/${encodeURIComponent(duplicate.existing.id)}`)}>打开现有 JD</button>
            <button className="ghost" type="button" onClick={() => setPhase("preview")}>返回预览</button>
          </div>
        </section>
      </main>
    );
  }

  if (!form || !ready) return null;

  function startEditing() {
    setDraft({ ...form! });
    setMessage("");
    setView("edit");
  }

  function finishEditing() {
    if (!draft?.job_title?.trim() || !draft.company_name?.trim() || !draft.description_text?.trim()) {
      setMessage("岗位名称、公司名称和职位描述不能为空。");
      return;
    }
    setForm(draft);
    setMessage("");
    setView("preview");
  }

  function cancelEditing() {
    setDraft(null);
    setMessage("");
    setView("preview");
  }

  const saveButton = <button className="primary" type="button" onClick={() => void submit()}>保存到求职记录</button>;
  const errorNotice = message && <p className="notice" role="alert">{message}</p>;

  if (view === "edit" && draft) {
    return (
      <main className="popup-page">
        {header}
        <form className="page-body editor-body" id="edit-job" onSubmit={(event) => { event.preventDefault(); finishEditing(); }}>
          <div className="section-heading editor-heading">
            <h1 ref={heading} tabIndex={-1}>编辑岗位信息</h1>
            <button className="text-button" type="button" onClick={finishEditing}>返回预览</button>
          </div>
          {errorNotice}
          <Field label="岗位名称" required value={draft.job_title ?? ""} onChange={(value) => updateField("job_title", value)} />
          <Field label="公司名称" required value={draft.company_name ?? ""} onChange={(value) => updateField("company_name", value)} />
          <div className="two-columns">
            <Field label="薪资" value={draft.salary_text ?? ""} onChange={(value) => updateField("salary_text", value)} />
            <Field label="城市" value={draft.work_city ?? ""} onChange={(value) => updateField("work_city", value)} />
          </div>
          <label>
            <span>职位描述</span>
            <textarea aria-label="职位描述" required value={draft.description_text ?? ""} onChange={(event) => updateField("description_text", event.target.value)} />
          </label>
        </form>
        <footer className="page-footer editor-footer">
          <button className="secondary" type="button" onClick={cancelEditing}>取消</button>
          <button className="primary" type="submit" form="edit-job">完成编辑</button>
        </footer>
      </main>
    );
  }

  if (view === "description") {
    return (
      <main className="popup-page">
        {header}
        <section className="description-body">
          <div className="section-heading description-heading">
            <h1 ref={heading} tabIndex={-1}>完整职位描述</h1>
            <button className="text-button" type="button" onClick={() => setView("preview")}>收起描述</button>
          </div>
          <div className="description-scroll" tabIndex={0} aria-label="完整职位描述正文">
            {errorNotice}
            <div className="description-summary">
              <h2>{form.job_title}</h2>
              <p>{[form.company_name, form.work_city, form.salary_text].filter(Boolean).join(" · ")}</p>
            </div>
            <JobDescription text={form.description_text ?? ""} />
            {form.work_address && !form.description_text?.includes(form.work_address) && (
              <section className="description-section"><h2>工作地址</h2><p>{form.work_address}</p></section>
            )}
          </div>
        </section>
        <footer className="page-footer">{saveButton}</footer>
      </main>
    );
  }

  return (
    <main className="popup-page">
      {header}
      <section className="page-body preview-body">
        <p className="source-label">BOSS 直聘</p>
        <div className="job-identity preview-identity">
          <CompanyLogo name={form.company_name ?? ""} src={logo} />
          <div className="job-names">
            <h1 ref={heading} tabIndex={-1}>{form.job_title}</h1>
            <p>{form.company_name}</p>
          </div>
          <button className="text-button edit-button" type="button" onClick={startEditing}>编辑</button>
        </div>
        {[form.salary_text, form.work_city, form.experience_text, form.education_text].some(Boolean) && (
          <div className="job-facts">
            {form.salary_text && <p className="salary">{form.salary_text}</p>}
            <p className="job-meta">{[form.work_city, form.experience_text, form.education_text].filter(Boolean).join("　/　")}</p>
          </div>
        )}
        {form.skills.length > 0 && <div className="skills">{form.skills.map((skill, index) => <span key={`${skill}-${index}`}>{skill}</span>)}</div>}
        <section className="description-preview">
          <div className="section-heading">
            <h2>职位描述</h2>
            <button className="text-button" type="button" onClick={() => setView("description")}>查看全部</button>
          </div>
          <p className="description-excerpt">{form.description_text}</p>
        </section>
        {errorNotice}
      </section>
      <footer className="page-footer">{saveButton}</footer>
    </main>
  );
}

function CompanyLogo({ name, src }: { name: string; src?: string }) {
  const [failedSource, setFailedSource] = useState<string>();
  return <div className="company-logo" aria-label={`${name}公司图标`}>
    {src && failedSource !== src
      ? <img src={src} alt="" onError={() => setFailedSource(src)} />
      : <span aria-hidden="true">{Array.from(name.trim())[0] || "企"}</span>}
  </div>;
}

function useCompanyLogo(source?: string) {
  const [image, setImage] = useState<{ source: string; url: string }>();
  useEffect(() => {
    if (!source) return;
    let disposed = false;
    let objectUrl: string | undefined;
    void readBossLogo(source).then((blob) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setImage({ source, url: objectUrl });
    }).catch(() => { /* The company initial remains visible if the image cannot be read. */ });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source]);
  return image?.source === source ? image?.url : undefined;
}

function JobDescription({ text }: { text: string }) {
  // Only style explicit headings; keep the captured wording and ordering intact.
  const parts = text.split(/^(岗位职责|职位描述|工作职责|任职要求|职位要求|岗位要求|福利待遇|工作地址)[：:]?\s*$/m);
  return <div className="description-sections">{parts.map((part, index) => index % 2
    ? <h2 key={index}>{part}</h2>
    : part.trim() && <p key={index}>{part.trim()}</p>)}</div>;
}

function Field({ label, value, required = false, onChange }: { label: string; value: string; required?: boolean; onChange: (value: string) => void }) {
  return (
    <label>
      <span>{label}</span>
      <input required={required} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function StatusView({
  title,
  message,
  busy = false,
  tone = "neutral",
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  message: string;
  busy?: boolean;
  tone?: "neutral" | "success";
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <section className={`status-card ${tone}`} aria-live="polite" aria-busy={busy}>
      <div className="status-copy">
        <h1>{busy && <span className="spinner" aria-hidden="true" />}{title}</h1>
        <p>{message}</p>
      </div>
      {(actionLabel || secondaryLabel) && (
        <div className="actions vertical">
          {actionLabel && <button className="primary" type="button" onClick={onAction}>{actionLabel}</button>}
          {secondaryLabel && <button className="ghost" type="button" onClick={onSecondary}>{secondaryLabel}</button>}
        </div>
      )}
    </section>
  );
}

async function captureActiveBossTab(): Promise<BossCaptureResult> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !isBossJobUrl(tab.url)) {
    return { ok: false, error: "UNSUPPORTED_PAGE", message: "请先打开一个 BOSS 直聘岗位详情页。" };
  }
  return browser.tabs.sendMessage(tab.id, { type: CAPTURE_MESSAGE }) as Promise<BossCaptureResult>;
}

function captureErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/Receiving end does not exist|Could not establish connection/i.test(message)) {
    return "插件刚安装或更新。请刷新当前 BOSS 详情页，再点击插件。";
  }
  return "无法读取当前页面，请确认这是已加载完成的 BOSS 岗位详情页。";
}

function importErrorMessage(error: unknown): string {
  if (!(error instanceof LinkResumeApiError)) return "网络请求失败，请确认 LinkResume 仍在运行。";
  const messages: Record<string, string> = {
    INVALID_JOB_IMPORT: "抓取内容不完整或格式无效，请检查必填字段。",
    JD_EDIT_CONFLICT: "现有 JD 已被修改，请重新读取后再处理。",
    JD_WRITE_FAILED: "服务端保存失败，请稍后重试。",
  };
  return messages[error.code] ?? `导入失败：${error.code}`;
}

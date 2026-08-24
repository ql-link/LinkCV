import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import {
  LinkCVApiError,
  connectToLinkCV,
  importJob,
  linkCVUrl,
  type LinkCVConnection,
} from "../../src/api/linkcv";
import {
  CAPTURE_MESSAGE,
  type BossCaptureResult,
  type BossJobCapture,
  type DuplicateDetails,
  type DuplicateResolution,
  type JobRecord,
} from "../../src/contracts";
import { isBossJobUrl } from "../../src/extractor/boss";

type Phase = "loading" | "unavailable" | "login" | "capture-error" | "preview" | "submitting" | "duplicate" | "success";

const CONNECTING_MESSAGE = "正在连接 LinkResume 并读取当前页面…";
const isDevelopmentBuild = import.meta.env.WXT_PUBLIC_LINKCV_CHANNEL !== "production";

interface ReadyCapture {
  sourceUrl: string;
  capture: BossJobCapture;
  warnings: string[];
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [connection, setConnection] = useState<LinkCVConnection | null>(null);
  const [ready, setReady] = useState<ReadyCapture | null>(null);
  const [form, setForm] = useState<BossJobCapture | null>(null);
  const [skillsText, setSkillsText] = useState("");
  const [message, setMessage] = useState(CONNECTING_MESSAGE);
  const [duplicate, setDuplicate] = useState<DuplicateDetails | null>(null);
  const [created, setCreated] = useState<JobRecord | null>(null);

  useEffect(() => {
    void initialize();
  }, []);

  async function initialize() {
    setPhase("loading");
    setMessage(CONNECTING_MESSAGE);
    try {
      const [nextConnection, capture] = await Promise.all([
        connectToLinkCV(),
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
        setMessage("请先登录 LinkResume，登录后重新点击插件。");
        return;
      }
      if (!capture.ok) {
        setPhase("capture-error");
        setMessage(capture.message);
        return;
      }
      setReady(capture);
      setForm(capture.capture);
      setSkillsText(capture.capture.skills.join("、"));
      setPhase("preview");
    } catch (error) {
      setPhase("capture-error");
      setMessage(captureErrorMessage(error));
    }
  }

  function updateField<K extends keyof BossJobCapture>(key: K, value: BossJobCapture[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  async function submit(resolution?: DuplicateResolution) {
    if (!connection || !ready || !form) return;
    if (!form.job_title?.trim() || !form.company_name?.trim() || !form.description_text?.trim()) {
      setMessage("岗位名称、公司名称和职位描述不能为空。");
      return;
    }
    setPhase("submitting");
    setMessage("正在整理并保存到 LinkResume…");
    try {
      const job = await importJob(connection.origin, {
        source_url: ready.sourceUrl,
        capture: {
          ...form,
          skills: skillsText.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean),
        },
        duplicate_resolution: resolution,
      });
      setCreated(job);
      setDuplicate(null);
      setPhase("success");
    } catch (error) {
      if (error instanceof LinkCVApiError && error.code === "JD_SOURCE_DUPLICATE" && error.duplicate) {
        setDuplicate(error.duplicate);
        setPhase("duplicate");
        return;
      }
      if (error instanceof LinkCVApiError && error.status === 401) {
        setPhase("login");
        setMessage("LinkResume 登录已失效，请重新登录后再试。");
        return;
      }
      setPhase("preview");
      setMessage(importErrorMessage(error));
    }
  }

  async function openLinkCV(path: string) {
    if (!connection) return;
    await browser.tabs.create({ url: linkCVUrl(connection.origin, path) });
  }

  const header = (
    <header className="app-header">
      <div className="brand-lockup">
        <img className="mark" src="/linkresume-mark.png" alt="" aria-hidden="true" />
        <div className="brand-copy">
          <strong>LinkResume</strong>
          <span>岗位采集</span>
        </div>
      </div>
      {isDevelopmentBuild && <span className="environment-badge">开发版</span>}
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
          actionLabel="打开 LinkResume 登录"
          onAction={() => void openLinkCV("/login")}
          secondaryLabel="我已登录，重试"
          onSecondary={() => void initialize()}
        />
      </main>
    );
  }

  if (phase === "capture-error") {
    return <main>{header}<StatusView title="无法读取岗位" message={message} actionLabel="重新读取" onAction={() => void initialize()} /></main>;
  }

  if (phase === "success" && created) {
    return (
      <main>
        {header}
        <StatusView
          title="岗位已保存"
          tone="success"
          message={`已保存「${created.job_title}」`}
          actionLabel="打开 JD 详情"
          onAction={() => void openLinkCV(`/jobs/${created.id}`)}
          secondaryLabel="打开编辑页"
          onSecondary={() => void openLinkCV(`/jobs/${created.id}/edit`)}
        />
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
          <span className="eyebrow">发现重复来源</span>
          <h1>{duplicate.existing.job_title}</h1>
          <p>{duplicate.existing.company_name} 已存在于你的 LinkResume。</p>
          <div className="actions vertical">
            {duplicate.allowed_actions.includes("update") && (
              <button className="primary" type="button" onClick={() => void submit(resolution())}>用本次内容更新</button>
            )}
            <button className="secondary" type="button" onClick={() => void openLinkCV(`/jobs/${duplicate.existing.id}`)}>打开现有 JD</button>
            <button className="ghost" type="button" onClick={() => setPhase("preview")}>返回预览</button>
          </div>
        </section>
      </main>
    );
  }

  if (!form || !ready) return null;
  return (
    <main>
      {header}
      <section className="preview-heading">
        <div>
          <span className="eyebrow">保存到 LinkResume</span>
          <h1>核对岗位信息</h1>
          <p>必要时修改内容，再确认导入 JD 中心。</p>
        </div>
        <span className="source-pill">BOSS 直聘</span>
      </section>

      {message !== CONNECTING_MESSAGE && <div className="notice" role="alert">{message}</div>}
      {ready.warnings.length > 0 && <div className="notice muted" role="status">{ready.warnings.join("；")}</div>}

      <section className="form-grid">
        <Field label="岗位名称 *" value={form.job_title ?? ""} onChange={(value) => updateField("job_title", value)} />
        <Field label="公司名称 *" value={form.company_name ?? ""} onChange={(value) => updateField("company_name", value)} />
        <div className="two-columns">
          <Field label="薪资" value={form.salary_text ?? ""} onChange={(value) => updateField("salary_text", value)} />
          <Field label="城市" value={form.work_city ?? ""} onChange={(value) => updateField("work_city", value)} />
        </div>
        <Field label="工作地址" value={form.work_address ?? ""} onChange={(value) => updateField("work_address", value)} />
        <div className="two-columns">
          <Field label="经验" value={form.experience_text ?? ""} onChange={(value) => updateField("experience_text", value)} />
          <Field label="学历" value={form.education_text ?? ""} onChange={(value) => updateField("education_text", value)} />
        </div>
        <Field
          label="工作/实习安排"
          value={form.work_schedule_text ?? ""}
          onChange={(value) => updateField("work_schedule_text", value)}
        />
        <Field label="技能（用逗号或顿号分隔）" value={skillsText} onChange={setSkillsText} />
        <label>
          <span>职位描述 *</span>
          <textarea value={form.description_text ?? ""} onChange={(event) => updateField("description_text", event.target.value)} />
        </label>
      </section>

      <footer className="sticky-footer">
        <button className="secondary" type="button" onClick={() => void initialize()}>重新读取</button>
        <button className="primary" type="button" onClick={() => void submit()}>确认导入</button>
      </footer>
    </main>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
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
    <section className={`status-card ${tone}`} aria-live="polite">
      <div className={busy ? "spinner" : `status-icon ${tone}`} aria-hidden="true">
        {!busy && (tone === "success" ? <CheckIcon /> : <InfoIcon />)}
      </div>
      <div className="status-copy">
        <h1>{title}</h1>
        <p>{message}</p>
      </div>
      {(actionLabel || secondaryLabel) && (
        <div className="actions vertical">
          {actionLabel && <button className="primary" type="button" onClick={onAction}>{actionLabel}</button>}
          {secondaryLabel && <button className="secondary" type="button" onClick={onSecondary}>{secondaryLabel}</button>}
        </div>
      )}
    </section>
  );
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24" focusable="false"><path d="m5 12.5 4.2 4.2L19 7" /></svg>;
}

function InfoIcon() {
  return <svg viewBox="0 0 24 24" focusable="false"><path d="M12 10.5v6M12 7.5h.01" /></svg>;
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
  if (!(error instanceof LinkCVApiError)) return "网络请求失败，请确认 LinkResume 仍在运行。";
  const messages: Record<string, string> = {
    INVALID_JOB_IMPORT: "抓取内容不完整或格式无效，请检查必填字段。",
    JD_EDIT_CONFLICT: "现有 JD 已被修改，请重新读取后再处理。",
    JD_WRITE_FAILED: "服务端保存失败，请稍后重试。",
  };
  return messages[error.code] ?? `导入失败：${error.code}`;
}

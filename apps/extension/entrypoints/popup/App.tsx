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
  const [message, setMessage] = useState("正在连接 LinkCV 并读取当前页面…");
  const [duplicate, setDuplicate] = useState<DuplicateDetails | null>(null);
  const [created, setCreated] = useState<JobRecord | null>(null);

  useEffect(() => {
    void initialize();
  }, []);

  async function initialize() {
    setPhase("loading");
    setMessage("正在连接 LinkCV 并读取当前页面…");
    try {
      const [nextConnection, capture] = await Promise.all([
        connectToLinkCV(),
        captureActiveBossTab(),
      ]);
      setConnection(nextConnection);
      if (!nextConnection) {
        setPhase("unavailable");
        setMessage("没有连接到本地 LinkCV。请先启动 npm run dev。");
        return;
      }
      if (!nextConnection.user) {
        setPhase("login");
        setMessage("请先在 LinkCV 登录，登录后重新点击插件。");
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
    setMessage("正在清洗并保存到 LinkCV…");
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
        setMessage("LinkCV 登录已失效，请重新登录后再试。");
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
      <div className="mark">LC</div>
      <div>
        <strong>LinkCV 岗位采集</strong>
        <span>只读取当前 BOSS 详情页</span>
      </div>
    </header>
  );

  if (phase === "loading" || phase === "submitting") {
    return <main>{header}<StatusView busy message={message} /></main>;
  }

  if (phase === "unavailable") {
    return <main>{header}<StatusView message={message} actionLabel="重试连接" onAction={() => void initialize()} /></main>;
  }

  if (phase === "login") {
    return (
      <main>
        {header}
        <StatusView
          message={message}
          actionLabel="打开 LinkCV 登录"
          onAction={() => void openLinkCV("/login")}
          secondaryLabel="我已登录，重试"
          onSecondary={() => void initialize()}
        />
      </main>
    );
  }

  if (phase === "capture-error") {
    return <main>{header}<StatusView message={message} actionLabel="重新读取" onAction={() => void initialize()} /></main>;
  }

  if (phase === "success" && created) {
    return (
      <main>
        {header}
        <StatusView
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
    const resolution = (action: "update" | "restore"): DuplicateResolution => ({
      action,
      job_description_id: duplicate.existing.id,
      base_lock_version: duplicate.existing.lock_version,
    });
    return (
      <main>
        {header}
        <section className="status-card compact">
          <span className="eyebrow">发现重复来源</span>
          <h2>{duplicate.existing.job_title}</h2>
          <p>{duplicate.existing.company_name} 已存在于你的 LinkCV。</p>
          <div className="actions vertical">
            {duplicate.allowed_actions.includes("update") && (
              <button className="primary" onClick={() => void submit(resolution("update"))}>用本次内容更新</button>
            )}
            {duplicate.allowed_actions.includes("restore") && (
              <button onClick={() => void submit(resolution("restore"))}>恢复原记录</button>
            )}
            <button onClick={() => void openLinkCV(`/jobs/${duplicate.existing.id}`)}>打开现有 JD</button>
            <button className="ghost" onClick={() => setPhase("preview")}>返回预览</button>
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
          <span className="eyebrow">导入预览</span>
          <p>可修改后再保存；页面原文不会直接落库。</p>
        </div>
        <span className="source-pill">BOSS</span>
      </section>

      {message !== "正在连接 LinkCV 并读取当前页面…" && <div className="notice">{message}</div>}
      {ready.warnings.length > 0 && <div className="notice muted">{ready.warnings.join("；")}</div>}

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
        <button className="ghost" onClick={() => void initialize()}>重新读取</button>
        <button className="primary" onClick={() => void submit()}>确认导入</button>
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
  message,
  busy = false,
  tone = "neutral",
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  message: string;
  busy?: boolean;
  tone?: "neutral" | "success";
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <section className={`status-card ${tone}`}>
      <div className={busy ? "spinner" : `status-icon ${tone}`}>{busy ? "" : tone === "success" ? "✓" : "i"}</div>
      <p>{message}</p>
      {(actionLabel || secondaryLabel) && (
        <div className="actions vertical">
          {actionLabel && <button className="primary" onClick={onAction}>{actionLabel}</button>}
          {secondaryLabel && <button onClick={onSecondary}>{secondaryLabel}</button>}
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
  if (!(error instanceof LinkCVApiError)) return "网络请求失败，请确认 LinkCV 仍在运行。";
  const messages: Record<string, string> = {
    INVALID_JOB_IMPORT: "抓取内容不完整或格式无效，请检查必填字段。",
    JD_EDIT_CONFLICT: "现有 JD 已被修改，请重新读取后再处理。",
    JD_WRITE_FAILED: "服务端保存失败，请稍后重试。",
  };
  return messages[error.code] ?? `导入失败：${error.code}`;
}

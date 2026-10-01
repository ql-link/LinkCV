// 07.1a 新建模拟面试（Figma 159:767；作答方式区块见 198:2，由 voice/AnswerModePicker 提供）。
// 简历 / 求职记录 / 参考资料来自真实接口；通过 mockInterviewApi.create 发起后端准备任务。
import { useEffect, useMemo, useState } from "react";
import { api, type DatasetRecord, type JobApplicationSummary, type ResumeSummary } from "@/api/client";
import { mockInterviewPath, navigateTo } from "@/routing";
import { Icon } from "@/v3/Icon";
import { Dialog, DialogFooter, Segmented, Select, Toast, Toggle, PageEyebrow } from "@/v3/primitives";
import { AnswerModePicker } from "./voice/AnswerModePicker";
import {
  DIFFICULTY_LABELS,
  INTERVIEW_TYPE_LABELS,
  mockInterviewApi,
  mockInterviewErrorMessage,
  type MockAnswerMode,
  type MockDifficulty,
  type MockInterviewType,
  type MockLanguage,
} from "./mockInterviewApi";
import { mmdd } from "./mockShared";

const TYPE_ORDER: MockInterviewType[] = ["technical", "project_deep_dive", "comprehensive", "hr"];
const DIFFICULTY_ORDER: MockDifficulty[] = ["junior", "intermediate", "senior"];
const MAX_MATERIALS = 10;

const TYPE_HINTS: Record<MockInterviewType, string> = {
  technical: "考察技术原理、编码与系统设计",
  project_deep_dive: "围绕简历里的项目层层追问：背景、方案、取舍与结果",
  comprehensive: "技术、项目与软素质各问一些，适合还不确定考察重点时",
  hr: "动机、职业规划、协作与薪资期望",
};
const DIFFICULTY_HINTS: Record<MockDifficulty, string> = {
  junior: "从事实与原理问起，追问到方案权衡为止",
  intermediate: "从原理与权衡问起，追问会触及边界情况",
  senior: "从方案权衡问起，追问会深入到边界情况与迁移能力",
};

const NO_JOB = "__none__";
const PASTE_JD = "__paste__";

function readQuery() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("type");
  return {
    type: TYPE_ORDER.includes(type as MockInterviewType) ? (type as MockInterviewType) : null,
    general: params.get("general") === "1",
  };
}

function defaultTypeForStage(stage: string | null | undefined): MockInterviewType {
  return stage?.trim().toUpperCase().startsWith("HR") ? "hr" : "comprehensive";
}

// 文档类且解析成功的资料才能作为参考资料
function selectableMaterial(item: DatasetRecord) {
  return (item.asset_kind ?? "document") === "document" && item.upload_status === "succeeded" && item.parse_status === "succeeded";
}

export function MockInterviewNew({ applicationId, resumeId }: { applicationId?: string; resumeId?: string }) {
  const query = useMemo(readQuery, []);
  const [resumes, setResumes] = useState<ResumeSummary[] | null>(null);
  const [applications, setApplications] = useState<JobApplicationSummary[]>([]);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);

  const [resume, setResume] = useState<string>(resumeId ?? "");
  const [job, setJob] = useState<string>(query.general ? NO_JOB : applicationId ?? "");
  const [jdText, setJdText] = useState("");
  const [type, setType] = useState<MockInterviewType>(query.type ?? "comprehensive");
  const [typeTouched, setTypeTouched] = useState(Boolean(query.type));
  const [difficulty, setDifficulty] = useState<MockDifficulty>("intermediate");
  const [count, setCount] = useState(5);
  const [followUp, setFollowUp] = useState(true);
  const [language, setLanguage] = useState<MockLanguage>("zh");
  const [answerMode, setAnswerMode] = useState<MockAnswerMode>("text");
  const [materials, setMaterials] = useState<string[]>([]);
  const [materialsInQuestions, setMaterialsInQuestions] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [resumeList, apps] = await Promise.all([api.listResumes(), api.listJobApplications({ scope: "active" }).catch(() => ({ items: [] as JobApplicationSummary[] }))]);
        if (!alive) return;
        setResumes(resumeList.resumes);
        setApplications(apps.items.filter((item) => item.status === "active"));
        setLoadFailed(false);
      } catch {
        if (alive) setLoadFailed(true);
      }
      api.listDatasets().then((result) => { if (alive) setDatasets(result.datasets); }).catch(() => undefined);
      mockInterviewApi.speechCapability().then((result) => { if (alive) setSpeechAvailable(result.stt && result.tts); }).catch(() => undefined);
    })();
    return () => { alive = false; };
  }, []);

  const selectedApp = applications.find((item) => item.id === job) ?? null;

  // 选定求职记录时：简历默认用记录关联的简历；面试类型按阶段推荐（用户没手动改过时）
  useEffect(() => {
    if (!selectedApp) return;
    if (selectedApp.resume_id && resumes?.some((item) => item.id === selectedApp.resume_id)) setResume(selectedApp.resume_id);
    if (!typeTouched) setType(defaultTypeForStage(selectedApp.current_stage_label));
  }, [selectedApp, resumes, typeTouched]);

  // 没有指定简历时默认最近更新的一份
  useEffect(() => {
    if (!resume && resumes?.length) setResume([...resumes].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0].id);
  }, [resume, resumes]);

  const resumeOptions = (resumes ?? []).map((item) => ({ value: item.id, label: item.title, hint: `${mmdd(item.updated_at)} 更新` }));
  const jobOptions = [
    ...applications.map((item) => ({ value: item.id, label: `${item.company_name_snapshot} · ${item.job_title_snapshot}`, hint: item.current_stage_label })),
    { value: NO_JOB, label: "不指定岗位", hint: "按简历做通用面试" },
    { value: PASTE_JD, label: "粘贴一段 JD", hint: "没有求职记录时" },
  ];
  const selectedResume = resumes?.find((item) => item.id === resume) ?? null;
  const selectable = datasets.filter(selectableMaterial);
  const recommendedByStage = Boolean(selectedApp && !query.type && type === defaultTypeForStage(selectedApp.current_stage_label));
  const summary = `${count} 道题 · ${language === "zh" ? "中文" : "英文"} · ${followUp ? "允许追问" : "不追问"} · ${materials.length ? `${materials.length} 份参考资料` : "未选参考资料"}`;
  const canSubmit = Boolean(resume) && !submitting && (job !== PASTE_JD || jdText.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { mock_interview } = await mockInterviewApi.create({
        job_application_id: selectedApp?.id,
        resume_id: resume || undefined,
        job_description_text: job === PASTE_JD ? jdText.trim() : undefined,
        interview_type: type,
        difficulty,
        question_count: count,
        follow_up_enabled: followUp,
        language,
        answer_mode: answerMode,
        material_ids: materials,
        materials_in_questions: materialsInQuestions,
      });
      navigateTo(mockInterviewPath(mock_interview.id), { replace: true });
    } catch (reason) {
      const inProgress = reason instanceof Error && reason.message === "MOCK_INTERVIEW_IN_PROGRESS";
      setError({ title: inProgress ? "已有一场进行中的模拟面试" : "没能开始面试", message: mockInterviewErrorMessage(reason) });
      setSubmitting(false);
    }
  };

  return (
    <div className="mi-page mi-new">
      <div className="mi-new-form">
        <PageEyebrow segments={[{ label: "MOCK INTERVIEW", href: "/mock-interviews", onClick: () => navigateTo("/mock-interviews"), ariaLabel: "返回模拟面试" }, "新建"]} />
        <h1 className="mi-serif-title">开始一场模拟面试</h1>
        <p className="mi-new-sub">选一份简历，再告诉面试官你要面哪个岗位。</p>

        <div className="mi-new-field">
          <label className="mi-new-label" htmlFor="mi-resume">简历</label>
          <Select id="mi-resume" className="mi-new-select" label="简历" value={resume} options={resumeOptions} onChange={setResume} placeholder={resumes === null ? (loadFailed ? "简历没有加载出来" : "正在加载简历…") : resumes.length ? "选择一份简历" : "还没有简历，先去创建一份"} disabled={!resumes?.length} />
          {loadFailed && <p className="mi-new-hint is-error">简历没有加载出来，<button type="button" className="mi-inline-link" onClick={() => window.location.reload()}>刷新重试</button></p>}
          {resumes?.length === 0 && <p className="mi-new-hint">模拟面试需要一份简历，<button type="button" className="mi-inline-link" onClick={() => navigateTo("/resumes/new")}>去创建</button></p>}
        </div>

        <div className="mi-new-field">
          <label className="mi-new-label" htmlFor="mi-job">目标岗位 <small>可选</small></label>
          <Select id="mi-job" className="mi-new-select" label="目标岗位" value={job} options={jobOptions} onChange={setJob} placeholder="选择一条求职记录" />
          {job === PASTE_JD ? (
            <textarea className="v3-textarea mi-jd" aria-label="岗位 JD" placeholder="粘贴岗位描述，面试官会按 JD 要求出题" value={jdText} maxLength={8000} onChange={(event) => setJdText(event.target.value)} />
          ) : (
            <p className="mi-new-hint">
              {job === NO_JOB ? "只根据你的简历出题，适合日常保持手感。" : "将带入该求职记录的 JD 和当前阶段。"}
              <button type="button" className="mi-inline-link" onClick={() => setJob(PASTE_JD)}>没有求职记录？粘贴 JD</button>
            </p>
          )}
        </div>

        <div className="mi-new-field">
          <span className="mi-new-label">面试类型</span>
          <div className="mi-new-seg">
            <Segmented<MockInterviewType> label="面试类型" value={type} onChange={(value) => { setType(value); setTypeTouched(true); }} options={TYPE_ORDER.map((value) => ({ value, label: INTERVIEW_TYPE_LABELS[value] }))} />
          </div>
          <p className="mi-new-hint">{TYPE_HINTS[type]}{recommendedByStage && selectedApp ? ` · 已按「${selectedApp.current_stage_label}」推荐` : ""}</p>
        </div>

        <div className="mi-new-field">
          <span className="mi-new-label">难度</span>
          <div className="mi-new-seg">
            <Segmented<MockDifficulty> label="难度" value={difficulty} onChange={setDifficulty} options={DIFFICULTY_ORDER.map((value) => ({ value, label: DIFFICULTY_LABELS[value] }))} />
          </div>
          <p className="mi-new-hint">{DIFFICULTY_HINTS[difficulty]}</p>
        </div>

        <div className="mi-new-field mi-new-mode">
          <AnswerModePicker value={answerMode} onChange={setAnswerMode} speechAvailable={speechAvailable} />
        </div>

        <button type="button" className="mi-more" onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <span>更多设置</span>
          <small>{summary}</small>
          <Icon name="chev" size={13} />
        </button>

        <button type="button" className="v3-btn v3-btn-dark mi-new-submit" disabled={!canSubmit} onClick={submit}>{submitting ? "正在创建…" : "开始面试"}</button>
        <p className="mi-new-foot">{answerMode === "voice" ? "下一步检测麦克风与面试官声音 · " : ""}准备约 30 秒 · 同一时间只能进行一场模拟面试</p>
      </div>

      {moreOpen && (
        <MoreSettingsDialog
          count={count}
          followUp={followUp}
          language={language}
          materials={materials}
          materialsInQuestions={materialsInQuestions}
          datasets={selectable}
          onClose={() => setMoreOpen(false)}
          onSave={(next) => { setCount(next.count); setFollowUp(next.followUp); setLanguage(next.language); setMaterials(next.materials); setMaterialsInQuestions(next.materialsInQuestions); setMoreOpen(false); }}
        />
      )}
      {error && (
        <Toast
          kind="error"
          title={error.title}
          message={error.message}
          onDismiss={() => setError(null)}
          action={error.title.startsWith("已有") ? <button type="button" className="v3-btn v3-btn-ghost is-sm" onClick={() => navigateTo("/mock-interviews")}>去查看</button> : undefined}
        />
      )}
    </div>
  );
}

// 「更多设置」：题数 3–10、追问、语言、参考资料（最多 10 份）
function MoreSettingsDialog({
  count: initialCount,
  followUp: initialFollowUp,
  language: initialLanguage,
  materials: initialMaterials,
  materialsInQuestions: initialMaterialsInQuestions,
  datasets,
  onClose,
  onSave,
}: {
  count: number;
  followUp: boolean;
  language: MockLanguage;
  materials: string[];
  materialsInQuestions: boolean;
  datasets: DatasetRecord[];
  onClose: () => void;
  onSave: (value: { count: number; followUp: boolean; language: MockLanguage; materials: string[]; materialsInQuestions: boolean }) => void;
}) {
  const [count, setCount] = useState(initialCount);
  const [followUp, setFollowUp] = useState(initialFollowUp);
  const [language, setLanguage] = useState<MockLanguage>(initialLanguage);
  const [materials, setMaterials] = useState(initialMaterials);
  const [materialsInQuestions, setMaterialsInQuestions] = useState(initialMaterialsInQuestions);
  const toggle = (id: string) => setMaterials((list) => list.includes(id) ? list.filter((item) => item !== id) : list.length >= MAX_MATERIALS ? list : [...list, id]);
  const countOptions = Array.from({ length: 8 }, (_, index) => String(index + 3)).map((value) => ({ value, label: `${value} 道题`, hint: `约 ${Number(value) * 4 + 5} 分钟` }));

  return (
    <Dialog width={520} label="更多设置" onClose={onClose}>
      <div className="v3-dialog-body mi-more-body">
        <h2 className="v3-dialog-title">更多设置</h2>
        <p className="v3-dialog-sub">主问题数量、追问与语言；参考资料默认只用于报告事实核验。</p>
        <div className="mi-more-row">
          <span><b>主问题数</b><small>3–10 道，不含追问</small></span>
          <div className="mi-more-select"><Select label="主问题数" value={String(count)} options={countOptions} onChange={(value) => setCount(Number(value))} /></div>
        </div>
        <div className="mi-more-row">
          <span><b>允许追问</b><small>每道主问题最多追问 2 次</small></span>
          <Toggle label="允许追问" checked={followUp} onChange={setFollowUp} />
        </div>
        <div className="mi-more-row">
          <span><b>面试语言</b><small>面试官提问与报告使用的语言</small></span>
          <Segmented<MockLanguage> label="面试语言" value={language} onChange={setLanguage} options={[{ value: "zh", label: "中文" }, { value: "en", label: "英文" }]} />
        </div>
        <div className="mi-more-row">
          <span><b>参考资料参与出题</b><small>关闭时只用于报告的事实核验</small></span>
          <Toggle label="参考资料参与出题" checked={materialsInQuestions} onChange={setMaterialsInQuestions} />
        </div>
        <div className="mi-more-materials">
          <div className="mi-more-materials-head">
            <b>参考资料</b>
            <small>{materials.length} / {MAX_MATERIALS} · 只能选解析成功的文档</small>
          </div>
          {datasets.length ? (
            <ul>
              {datasets.map((item) => {
                const checked = materials.includes(item.id);
                const full = !checked && materials.length >= MAX_MATERIALS;
                return (
                  <li key={item.id}>
                    <label className={full ? "is-disabled" : ""}>
                      <input type="checkbox" checked={checked} disabled={full} onChange={() => toggle(item.id)} />
                      <Icon name="doc" size={14} />
                      <span>{item.file_name}</span>
                      <small>{item.file_format.toUpperCase()}</small>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : <p className="mi-more-empty">资料库里还没有可用的文档，可以先去<button type="button" className="mi-inline-link" onClick={() => navigateTo("/datasets")}>资料库</button>上传。</p>}
        </div>
      </div>
      <DialogFooter>
        <button type="button" className="v3-btn v3-btn-ghost" onClick={onClose}>取消</button>
        <button type="button" className="v3-btn v3-btn-dark" onClick={() => onSave({ count, followUp, language, materials, materialsInQuestions })}>保存</button>
      </DialogFooter>
    </Dialog>
  );
}

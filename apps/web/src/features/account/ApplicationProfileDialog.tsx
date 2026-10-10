import { useEffect, useState } from "react";
import { api, ApiRequestError, type ApplicationData, type ApplicationImportPreview, type ApplicationRecordGroup, type ResumeSummary, type UserProfileData } from "@/api/client";
import { Dialog } from "@/v3/primitives";
import { accountErrorMessage } from "./accountErrors";
import "./application-profile.css";
import { t, useLocale } from "@/i18n";

export const emptyApplicationData = (): ApplicationData => ({ version: 1, resume_ids: [], basics: {}, contact: {}, others: {}, records: [] });
type Field = { key: string; label: string; options?: string[]; long?: boolean };
const fields = (entries: string[]): Field[] => entries.map((entry) => { const [key, label] = entry.split(":"); return { key, label }; });
export const APPLICATION_FIELDS: Record<string, Field[]> = {
  basics: [
    ...fields(["name:姓名", "englishName:英文名"]),
    { key: "gender", label: "性别", options: ["男", "女"] },
    ...fields(["birthDate:出生日期", "nationality:国籍", "ethnicity:民族"]),
    { key: "politicalStatus", label: "政治面貌", options: ["群众", "共青团员", "中共党员", "中共预备党员", "其他"] },
    { key: "idType", label: "证件类型", options: ["居民身份证", "护照", "港澳居民来往内地通行证", "台湾居民来往大陆通行证", "其他"] },
    ...fields(["idNumber:证件号码", "hometown:籍贯", "gaokaoOrigin:高考生源地", "hukou:户籍所在地"]),
    { key: "hukouType", label: "户籍性质", options: ["城镇", "农村", "居民户口", "其他"] },
    { key: "maritalStatus", label: "婚姻状况", options: ["未婚", "已婚", "离异", "丧偶"] },
  ],
  contact: fields(["phone:手机号码", "altPhone:备用电话", "email:电子邮箱", "city:现居城市", "address:通讯地址", "postcode:邮政编码", "country:居住国家或地区", "wechat:微信号"]),
  others: [...fields(["personalSite:个人主页", "portfolio:作品集链接"]), { key: "selfEvaluation", label: "自我评价", long: true }, { key: "hobbies", label: "兴趣爱好", long: true }],
  education: [
    ...fields(["school:学校名称", "department:学院", "major:专业", "degree:学历", "degreeTitle:学位", "city:学校所在城市", "enrollDate:入学时间", "gradDate:毕业时间"]),
    { key: "studyMode", label: "学习形式", options: ["全日制", "非全日制", "自学考试", "成人教育", "远程教育", "其他"] },
    { key: "trainingMode", label: "培养方式", options: ["统招", "定向", "非定向", "委培", "其他"] },
    ...fields(["duration:学制", "gpa:绩点", "gpaScale:绩点满分", "rank:成绩排名", "studentNumber:学号", "advisor:导师"]), { key: "courses", label: "主修课程", long: true },
  ],
  work: [...fields(["company:工作单位", "title:职位名称", "department:所在部门", "city:工作城市", "startDate:入职时间", "endDate:离职时间", "leaveReason:离职原因"]), { key: "summary", label: "工作职责", long: true }],
  internship: [...fields(["company:实习单位", "title:实习岗位", "department:实习部门", "city:实习城市", "startDate:实习开始时间", "endDate:实习结束时间"]), { key: "summary", label: "实习职责", long: true }],
  projects: [...fields(["name:项目名称", "role:项目角色", "startDate:项目开始时间", "endDate:项目结束时间", "link:项目链接"]), { key: "description", label: "项目描述", long: true }],
  languages: fields(["language:外语语种", "level:掌握程度", "cert:语言考试名称", "score:考试分数", "date:考试时间"]),
  certificates: fields(["name:证书名称", "date:发证日期", "issuer:发证机构", "number:证书编号"]),
  awards: [...fields(["title:奖项名称", "date:获奖时间", "level:获奖级别", "issuer:颁奖单位"]), { key: "description", label: "奖项说明", long: true }],
  campus: [...fields(["name:活动名称", "organization:校园组织", "title:担任职务", "startDate:开始时间", "endDate:结束时间"]), { key: "description", label: "校园活动内容", long: true }],
};
export const APPLICATION_GROUPS: Array<{ key: ApplicationRecordGroup; label: string }> = [
  { key: "education", label: "教育经历" }, { key: "work", label: "工作经历" }, { key: "internship", label: "实习经历" },
  { key: "projects", label: "项目经历" }, { key: "languages", label: "语言考试" }, { key: "certificates", label: "资格证书" },
  { key: "awards", label: "荣誉奖项" }, { key: "campus", label: "校园经历" },
];

export function validateApplicationDraft(data: ApplicationData): string | null {
  if (data.records.length > 100 || data.resume_ids.length > 20 || new TextEncoder().encode(JSON.stringify(data)).length > 65_536) return t("资料超过100条经历、20份关联简历或64KiB上限，请先整理旧资料再导入。");
  const groups = [
    ...(["basics", "contact", "others"] as const).map((group) => ({ group, fields: data[group] })), ...data.records,
  ];
  for (const item of groups) {
    for (const [key, raw] of Object.entries(item.fields)) {
      const value = raw.trim();
      if (!value) continue;
      const label = t(APPLICATION_FIELDS[item.group].find((field) => field.key === key)?.label || key);
      if (key === "date" || key.endsWith("Date")) {
        if (key === "endDate" && value === "至今") continue;
        const parts = value.split("-").map(Number);
        const year = parts[0] ?? 0, month = parts[1] ?? 1, day = parts[2] ?? 1;
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (!/^[1-9]\d{3}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(value) || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return t("{field} 请填写有效的 YYYY、YYYY-MM 或 YYYY-MM-DD。", { field: label });
      }
      if (["gpa", "gpaScale", "score"].includes(key) && !/^\d{1,5}(?:\.\d{1,4})?$/.test(value)) return t("{field} 请只填写数值，绩点满分另填。", { field: label });
    }
    const start = (item.fields.enrollDate || item.fields.startDate || "").trim();
    const end = (item.fields.gradDate || item.fields.endDate || "").trim();
    if (start && end && end !== "至今" && end.slice(0, Math.min(start.length, end.length)) < start.slice(0, Math.min(start.length, end.length))) return t("结束时间不能早于开始时间。");
    if (item.fields.gpaScale?.trim() && (Number(item.fields.gpaScale) <= 0 || item.fields.gpa?.trim() && Number(item.fields.gpa) > Number(item.fields.gpaScale))) return t("绩点不能超过满分，满分必须大于零。");
  }
  return null;
}

export function mergeImport(current: ApplicationData, imported: ApplicationData): ApplicationData {
  const result = structuredClone(current);
  result.resume_ids = [...new Set([...result.resume_ids, ...imported.resume_ids])];
  for (const group of ["basics", "contact", "others"] as const) {
    for (const [key, value] of Object.entries(imported[group])) if (!result[group][key]?.trim()) result[group][key] = value;
  }
  const sameSource = (a: ApplicationData["records"][number], b: ApplicationData["records"][number]) =>
    a.group === b.group && a.source?.resume_id === b.source?.resume_id && a.source?.fingerprint != null && a.source.fingerprint === b.source?.fingerprint;
  const sourceRecords = [...result.records];
  // Only a unique content match can carry supplements across reordered entries.
  // Changed or ambiguous entries retain their data, but lose the autofill association.
  result.records = result.records.map((record) => {
    if (!record.source?.fingerprint || !imported.resume_ids.includes(record.source.resume_id)) return record;
    const incoming = imported.records.filter((item) => sameSource(record, item));
    const old = sourceRecords.filter((item) => sameSource(record, item));
    return incoming.length === 1 && old.length === 1 ? { ...record, source: incoming[0].source } : { ...record, source: null };
  });
  for (const incoming of imported.records) {
    const matching = sourceRecords.filter((record) => sameSource(record, incoming));
    if (matching.length === 1 && imported.records.filter((record) => sameSource(record, incoming)).length === 1) continue;
    result.records.push({ ...incoming, id: result.records.some((record) => record.id === incoming.id) ? crypto.randomUUID() : incoming.id });
  }
  return result;
}

function FactFields({ group, values, onChange, prefix = "" }: { group: string; values: Record<string, string>; onChange?: (key: string, value: string) => void; prefix?: string }) {
  useLocale();
  return <div className="app-fact-fields">{APPLICATION_FIELDS[group].map((field) => <label className={`prof-field${field.long ? " app-fact-wide" : ""}`} key={field.key}>
    <span className="prof-label">{t(field.label)}</span>
    {!onChange ? <span className="app-fact-value">{values[field.key] || t("未填写")}</span>
      : field.options ? <select className="v3-input" aria-label={`${prefix}${t(field.label)}`} value={values[field.key] || ""} onChange={(e) => onChange(field.key, e.target.value)}>
        <option value="">{t("未填写")}</option>{field.options.map((option) => <option value={option} key={option}>{t(option)}</option>)}
        {values[field.key] && !field.options.includes(values[field.key]) && <option>{values[field.key]}</option>}
      </select>
        : field.long ? <textarea className="v3-input" aria-label={`${prefix}${t(field.label)}`} maxLength={4000} rows={4} value={values[field.key] || ""} onChange={(e) => onChange(field.key, e.target.value)} />
          : <input className="v3-input" aria-label={`${prefix}${t(field.label)}`} maxLength={["idNumber", "phone", "altPhone", "postcode", "studentNumber", "number"].includes(field.key) ? 100 : 4000} placeholder={field.key === "date" || field.key.endsWith("Date") ? "YYYY / YYYY-MM / YYYY-MM-DD" : t("未填写")} value={values[field.key] || ""} onChange={(e) => onChange(field.key, e.target.value)} />}
  </label>)}</div>;
}

export function ApplicationProfileDialog({ serverData, onClose, onSaved, onConflict }: {
  serverData: UserProfileData | null; onClose: () => void; onSaved: (data: UserProfileData) => void; onConflict: (data: UserProfileData) => void;
}) {
  useLocale();
  const [base, setBase] = useState(serverData);
  const [data, setData] = useState(() => structuredClone(serverData?.application_data || emptyApplicationData()));
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [resumeId, setResumeId] = useState("");
  const [active, setActive] = useState<"personal" | ApplicationRecordGroup>("personal");
  const [preview, setPreview] = useState<ApplicationImportPreview | null>(null);
  const [importError, setImportError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [resumeError, setResumeError] = useState(false);

  useEffect(() => {
    let alive = true;
    setResumeError(false);
    void api.listResumes().then((result) => { if (alive) setResumes(result.resumes); }).catch(() => { if (alive) setResumeError(true); });
    return () => { alive = false; };
  }, [loadAttempt]);

  const importResume = async () => {
    if (!resumeId || busy) return;
    setBusy(true); setMessage(""); setImportError("");
    try { setPreview(await api.previewApplicationImport(resumeId)); }
    catch (error) { setMessage(accountErrorMessage(error, "读取简历失败，请重试。")); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (busy) return;
    const invalid = validateApplicationDraft(data);
    if (invalid) { setMessage(invalid); return; }
    setBusy(true); setMessage("");
    try {
      const { lock_version, created_at: _created, updated_at: _updated, ...values } = base || await api.getUserProfile();
      const saved = await api.putUserProfile({ ...values, base_lock_version: lock_version, application_data: data });
      onSaved(saved);
    } catch (error) {
      if (error instanceof ApiRequestError && error.message === "USER_PROFILE_VERSION_CONFLICT") {
        const latest = (error.payload as { profile?: UserProfileData } | null)?.profile;
        if (latest) { setBase(latest); setData(structuredClone(latest.application_data || emptyApplicationData())); onConflict(latest); }
        setMessage("资料已在其他页面修改，已读取最新版本，请重新确认后保存。");
      } else setMessage(accountErrorMessage(error, "保存失败。请检查日期格式、分数和简历关联后重试。"));
    } finally { setBusy(false); }
  };
  const titleFor = (id: string) => resumes.find((resume) => resume.id === id)?.title || t("简历 {id}", { id });
  const updateRecord = (id: string, key: string, value: string) => setData((previous) => ({ ...previous, records: previous.records.map((record) => record.id === id ? { ...record, fields: { ...record.fields, [key]: value } } : record) }));

  return <>
    <Dialog width={1000} label={t("编辑网申资料")} className="app-profile-dialog" onClose={() => { if (!busy && !preview) onClose(); }} closable={!busy && !preview}>
      <div className="v3-dialog-body">
        <h2 className="v3-dialog-title">{t("网申资料")}</h2>
        <p className="v3-dialog-sub">{t("只填写确定的个人事实，未知项留空。求职偏好仍在个人画像中；志愿和岗位选择由你在招聘网站确认。")}</p>
        <div className="app-import-bar">
          <select className="v3-input" aria-label={t("导入来源简历")} value={resumeId} disabled={busy} onChange={(e) => setResumeId(e.target.value)}>
            <option value="">{t("选择已有简历")}</option>{resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.title}</option>)}
          </select>
          <button type="button" className="v3-btn v3-btn-ghost" disabled={!resumeId || busy} onClick={() => void importResume()}>{t("预览导入")}</button>
        </div>
        {resumeError && <p role="alert">{t("简历列表读取失败。")}<button type="button" className="acc-row-link" onClick={() => setLoadAttempt((n) => n + 1)}>{t("重试")}</button></p>}
        <div className="app-profile-tabs" role="tablist" aria-label={t("网申资料分类")}>
          {[{ key: "personal" as const, label: "个人信息" }, ...APPLICATION_GROUPS].map((group) => <button className="v3-btn v3-btn-ghost" type="button" role="tab" aria-selected={active === group.key} key={group.key} onClick={() => setActive(group.key)}>{t(group.label)}{group.key !== "personal" && ` (${data.records.filter((record) => record.group === group.key).length})`}</button>)}
        </div>
        <div className="app-profile-pane" role="tabpanel" aria-label={t(active === "personal" ? "个人信息" : APPLICATION_GROUPS.find((group) => group.key === active)!.label)}>
          {active === "personal" ? <>
            <fieldset className="app-fact-card"><legend>{t('个人信息用于哪些简历')}</legend><p className="v3-dialog-sub">{t('仅勾选确属本人的简历。插件只会向这些简历补充个人信息，姓名或字段冲突时会跳过。')}</p>
              {resumes.map((resume) => <label className="app-resume-choice" key={resume.id}><input type="checkbox" checked={data.resume_ids.includes(resume.id)} onChange={(e) => setData((previous) => ({ ...previous, resume_ids: e.target.checked ? [...previous.resume_ids, resume.id] : previous.resume_ids.filter((id) => id !== resume.id) }))} />{resume.title}</label>)}
              {data.resume_ids.filter((id) => !resumes.some((resume) => resume.id === id)).map((id) => <label className="app-resume-choice" key={id}><input type="checkbox" checked onChange={() => setData((previous) => ({ ...previous, resume_ids: previous.resume_ids.filter((value) => value !== id) }))} />{titleFor(id)}{t("（列表中不可用，可取消关联）")}</label>)}
            </fieldset>
            {(["basics", "contact", "others"] as const).map((group) => <section className="app-fact-card" key={group}><h3>{t({ basics: "身份信息", contact: "联系方式", others: "个人补充" }[group])}</h3><FactFields group={group} values={data[group]} onChange={(key, value) => setData((previous) => ({ ...previous, [group]: { ...previous[group], [key]: value } }))} /></section>)}
            <p className="v3-dialog-sub">{t('新增身份、联系方式和网申经历不会随个人画像自动加入 AI 对话资料。')}</p>
          </> : <>
            <p className="v3-dialog-sub">{t('日期保留已知精度，不补造月份或日期。导入条目与原简历对应；手动新增条目需明确关联简历，未关联资料只保存、不参与填写。')}</p>
            {data.records.filter((record) => record.group === active).map((record, index) => <section className="app-fact-card" key={record.id}>
              <div className="app-record-heading"><h3>{t(APPLICATION_GROUPS.find((group) => group.key === active)!.label)} {index + 1}</h3><button type="button" className="acc-row-link" onClick={() => setData((previous) => ({ ...previous, records: previous.records.filter((item) => item.id !== record.id) }))}>{t('移除条目')}</button></div>
              {record.source?.fingerprint ? <p className="v3-dialog-sub">{t("对应「{title}」原条目 {index}。来源变化时重新导入确认。", { title: titleFor(record.source.resume_id), index: (record.source.index ?? 0) + 1 })}<button type="button" className="acc-row-link" onClick={() => setData((previous) => ({ ...previous, records: previous.records.map((item) => item.id === record.id ? { ...item, source: null } : item) }))}>{t('解除关联')}</button></p>
                : <label className="prof-field"><span>{t('此条目作为补充用于哪份简历')}</span><select className="v3-input" aria-label={`${active} ${index + 1} 关联简历`} value={record.source?.resume_id || ""} onChange={(e) => setData((previous) => ({ ...previous, records: previous.records.map((item) => item.id === record.id ? { ...item, source: e.target.value ? { resume_id: e.target.value, index: null, fingerprint: null } : null } : item) }))}><option value="">{t('不参与自动填写')}</option>{resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.title}</option>)}</select></label>}
              <FactFields group={active} values={record.fields} prefix={`${active} ${index + 1} `} onChange={(key, value) => updateRecord(record.id, key, value)} />
            </section>)}
            <button type="button" className="v3-btn" disabled={data.records.length >= 100} onClick={() => setData((previous) => ({ ...previous, records: [...previous.records, { id: crypto.randomUUID(), group: active, fields: {}, source: null }] }))}>{t("新增{category}", { category: t(APPLICATION_GROUPS.find((group) => group.key === active)!.label) })}</button>
          </>}
        </div>
        {message && <p role="alert" className="app-profile-error">{t(message)}</p>}
        <div className="v3-dialog-foot"><button className="v3-btn" type="button" disabled={busy} onClick={onClose}>{t('取消')}</button><button className="v3-btn v3-btn-dark" type="button" disabled={busy} onClick={() => void save()}>{t(busy ? "处理中…" : "保存网申资料")}</button></div>
      </div>
    </Dialog>
    {preview && <Dialog width={850} label={t("确认导入网申资料")} onClose={() => setPreview(null)}>
      <div className="v3-dialog-body"><h2 className="v3-dialog-title">{t("确认导入「{title}」", { title: preview.title })}</h2>
        <p className="v3-dialog-sub">{t('以下是简历中明确出现的资料，未知项不会推测。个人信息已有值会保留；经历只有内容唯一对应时才沿用补充。变化或对应不明确的旧条目会保留资料并解除填写关联。确认后只加入草稿，保存后生效，不改写简历。')}</p>
        <div className="app-profile-pane app-import-preview">
          {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          {(["basics", "contact", "others"] as const).filter((group) => Object.keys(preview.application_data[group]).length > 0).map((group) => <section className="app-fact-card" key={group}><h3>{t({ basics: "身份信息", contact: "联系方式", others: "个人补充" }[group])}</h3><FactFields group={group} values={preview.application_data[group]} /></section>)}
          {preview.application_data.records.map((record) => <section className="app-fact-card" key={record.id}><h3>{t(APPLICATION_GROUPS.find((group) => group.key === record.group)!.label)} {(record.source?.index ?? 0) + 1}</h3><FactFields group={record.group} values={record.fields} /></section>)}
        </div>
        {importError && <p role="alert">{t(importError)}</p>}
        <div className="v3-dialog-foot"><button className="v3-btn" type="button" onClick={() => setPreview(null)}>{t('取消导入')}</button><button className="v3-btn v3-btn-dark" type="button" onClick={() => {
          const next = mergeImport(data, preview.application_data);
          if (next.records.length > 100 || next.resume_ids.length > 20 || new TextEncoder().encode(JSON.stringify(next)).length > 65_536) {
            setImportError("资料超过100条经历、20份关联简历或64KiB上限，请先整理旧资料再导入。"); return;
          }
          setData(next); setPreview(null); setMessage("已加入草稿，请核对补充后保存。");
        }}>{t('确认加入草稿')}</button></div>
      </div>
    </Dialog>}
  </>;
}

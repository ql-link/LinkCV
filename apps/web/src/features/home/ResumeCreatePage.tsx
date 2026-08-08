import { ArrowLeft, FilePlus2 } from "lucide-react";
import { useState } from "react";
import { ApiRequestError, type ResumeTemplate } from "../../api/client";
import { Button, Toast } from "../../components/ds";
import { editorPath, navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import { TemplatePicker } from "./TemplatePicker";

function createErrorMessage(error: unknown) {
  if (!(error instanceof ApiRequestError)) return "创建简历失败，请稍后重试。";
  if (error.message === "INVALID_RESUME_TITLE") return "请输入 1–255 个字符的简历名称。";
  if (error.message === "RESUME_TITLE_CONFLICT") return "该名称已经存在，请换一个名称。";
  if (error.message === "RESUME_LIMIT_REACHED") return "简历数量已达上限，请先清理已有简历。";
  if (error.message === "TEMPLATE_INACTIVE") return "所选模板已不可用，请重新选择。";
  return "创建简历失败，请稍后重试。";
}

export function ResumeCreatePage() {
  const createResume = useResumeStore((state) => state.createResume);
  const [selected, setSelected] = useState<ResumeTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialTemplateId = new URLSearchParams(window.location.search).get("template");

  const submit = async () => {
    if (submitting) return;
    if (!selected) {
      setError("请先选择一套简历模板。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const resumeId = await createResume(title, selected.id);
      navigateTo(editorPath(resumeId));
    } catch (reason) {
      setError(createErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="resume-create-page">
      <header className="resume-create-header">
        <button type="button" onClick={() => navigateTo("/resumes")}><ArrowLeft size={18} />返回</button>
        <div><span>新建简历</span><h1>选择一个起点</h1><p>所有简历都从模板创建，空白简历也作为模板提供。</p></div>
      </header>
      <TemplatePicker
        selectedTemplateId={selected?.id ?? null}
        initialTemplateId={initialTemplateId}
        onSelect={setSelected}
      />
      <section className="resume-create-name">
        <label htmlFor="resume-create-title">简历名称</label>
        <input
          id="resume-create-title"
          value={title}
          maxLength={255}
          placeholder="例如：2026 产品经理简历"
          onChange={(event) => setTitle(event.target.value)}
        />
        <small>同一账号内名称不能重复；系统会清理首尾和连续空格。</small>
      </section>
      {error && <Toast kind="error">{error}</Toast>}
      <footer className="resume-create-actions">
        <Button variant="secondary" onClick={() => navigateTo("/resumes")}>取消</Button>
        <Button icon={<FilePlus2 size={16} />} disabled={submitting} onClick={() => void submit()}>
          {submitting ? "正在创建…" : "创建并开始编辑"}
        </Button>
      </footer>
    </main>
  );
}

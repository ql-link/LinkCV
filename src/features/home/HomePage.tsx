import { FileText, LogOut, Plus, Trash2, PenLine } from "lucide-react";
import { useResumeStore } from "../../store/resumeStore";

export function HomePage() {
  const user = useResumeStore((state) => state.user);
  const resumes = useResumeStore((state) => state.resumes);
  const createResume = useResumeStore((state) => state.createResume);
  const loadResume = useResumeStore((state) => state.loadResume);
  const deleteResume = useResumeStore((state) => state.deleteResume);
  const logout = useResumeStore((state) => state.logout);

  return (
    <main className="home-shell">
      <header className="home-hero-band">
        <div className="hero-content">
          <h1>简历工作台</h1>
          <p>{user?.email}</p>
        </div>
        <div className="hero-actions">
          <button className="button-primary" onClick={() => void createResume("未命名简历")}>
            <Plus size={16} />
            新建简历
          </button>
          <button className="button-secondary" onClick={() => void logout()}>
            <LogOut size={16} />
            退出
          </button>
        </div>
      </header>

      {resumes.length === 0 ? (
        <section className="home-empty-state">
          <div className="empty-content">
            <PenLine size={48} strokeWidth={1} />
            <h2>您还没有简历</h2>
            <p>创建一个新的文档，开始您的创作之旅。</p>
            <button className="button-primary" onClick={() => void createResume("我的第一份简历")}>
              <Plus size={16} />
              创建第一份简历
            </button>
          </div>
        </section>
      ) : (
        <section className="resume-grid">
          {resumes.map((resume) => (
            <article className="feature-card" key={resume.id}>
              <div className="feature-card-main" onClick={() => void loadResume(resume.id)}>
                <FileText size={24} className="feature-icon" />
                <h3 className="feature-title">{resume.title}</h3>
                <span className="feature-caption">更新于 {formatTime(resume.updatedAt)}</span>
              </div>
              <button
                className="icon-button danger feature-action"
                title="删除简历"
                onClick={() => {
                  if (window.confirm(`确定删除「${resume.title}」吗？`)) {
                    void deleteResume(resume.id);
                  }
                }}
              >
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

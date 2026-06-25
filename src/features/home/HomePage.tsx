import { FileText, LogOut, Plus, Trash2 } from "lucide-react";
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
      <header className="home-header">
        <div>
          <h1>简历主页</h1>
          <p>{user?.email}</p>
        </div>
        <div className="home-actions">
          <button className="secondary-action" onClick={() => void logout()}>
            <LogOut size={14} />
            退出
          </button>
          <button className="primary-action" onClick={() => void createResume("未命名简历")}>
            <Plus size={14} />
            新建简历
          </button>
        </div>
      </header>
      {resumes.length === 0 ? (
        <section className="empty-state">
          <FileText size={36} />
          <h2>还没有简历</h2>
          <p>创建第一份简历后，内容会保存到本地 SQLite 数据库。</p>
          <button className="primary-action" onClick={() => void createResume("我的第一份简历")}>
            <Plus size={14} />
            创建简历
          </button>
        </section>
      ) : (
        <section className="resume-grid">
          {resumes.map((resume) => (
            <article className="resume-card" key={resume.id}>
              <button className="resume-card-main" onClick={() => void loadResume(resume.id)}>
                <FileText size={22} />
                <span>{resume.title}</span>
                <small>更新于 {formatTime(resume.updatedAt)}</small>
              </button>
              <button
                className="icon-button danger"
                title="删除简历"
                onClick={() => {
                  if (window.confirm(`确定删除「${resume.title}」吗？`)) {
                    void deleteResume(resume.id);
                  }
                }}
              >
                <Trash2 size={15} />
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

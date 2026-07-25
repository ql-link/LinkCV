import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, LayoutTemplate, LogOut, PenLine, Plus, Search, X } from "lucide-react";
import type { ResumeSummary } from "../../api/client";
import { Brand, Button, Toast } from "../../components/ds";
import { useResumeStore } from "../../store/resumeStore";
import { editorPath, navigateTo } from "../../routing";

type HomeScreenProps = {
  email: string;
  resumes: ResumeSummary[];
  onOpen: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onCreate: () => void | Promise<void>;
  onLogout: () => void | Promise<void>;
};

type PendingDelete = Pick<ResumeSummary, "id" | "title">;

function ResumeThumbnailCard({
  resume,
  onOpen,
  onDelete,
  deleteDisabled = false,
}: {
  resume: Pick<ResumeSummary, "id" | "title" | "updatedAt">;
  onOpen: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
}) {
  return (
    <article className="home-resume-card">
      <button className="home-card-open" type="button" onClick={onOpen}>
        <span className="home-card-preview" aria-hidden="true">
          <span className="home-card-paper">
            <i className="home-card-title-line" />
            <i style={{ width: "92%" }} />
            <i />
            <i style={{ width: "70%" }} />
            <i style={{ width: "85%" }} />
          </span>
        </span>
        <span className="home-card-meta">
          <strong>{resume.title}</strong>
          <small>更新于 {resume.updatedAt === "内置" ? "内置" : formatTime(resume.updatedAt)}</small>
        </span>
      </button>
      {onDelete && (
        <button
          className="home-card-delete"
          type="button"
          aria-label={`删除简历 ${resume.title}`}
          title="删除简历"
          disabled={deleteDisabled}
          onClick={onDelete}
        >
          <X size={14} />
        </button>
      )}
    </article>
  );
}

export function HomeScreen({ email, resumes, onOpen, onDelete, onCreate, onLogout }: HomeScreenProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const deleteTimerRef = useRef<number | null>(null);
  const [tab, setTab] = useState<"all" | "templates">("all");
  const [query, setQuery] = useState("");
  const [scrollAmount, setScrollAmount] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  useEffect(() => () => {
    if (deleteTimerRef.current !== null) {
      window.clearTimeout(deleteTimerRef.current);
    }
  }, []);

  const visibleResumes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return resumes
      .filter((resume) => resume.id !== pendingDelete?.id)
      .filter((resume) => resume.title.toLocaleLowerCase().includes(normalizedQuery));
  }, [pendingDelete?.id, query, resumes]);

  const requestDelete = (resume: ResumeSummary) => {
    if (pendingDelete) return;
    setPendingDelete({ id: resume.id, title: resume.title });
    deleteTimerRef.current = window.setTimeout(() => {
      deleteTimerRef.current = null;
      void Promise.resolve(onDelete(resume.id)).finally(() => setPendingDelete(null));
    }, 5000);
  };

  const undoDelete = () => {
    if (deleteTimerRef.current !== null) {
      window.clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setPendingDelete(null);
  };

  const handleScroll = () => {
    const element = scrollRef.current;
    if (element) setScrollAmount(Math.min(1, element.scrollTop / 60));
  };

  return (
    <main className="dashboard-shell">
      <nav className="dashboard-sidebar" aria-label="简历主页导航">
        <Brand className="dashboard-brand" />
        <div className="dashboard-tabs">
          <button className={tab === "all" ? "is-active" : ""} type="button" onClick={() => setTab("all")}>
            <FileText size={16} />全部简历
          </button>
          <button className={tab === "templates" ? "is-active" : ""} type="button" onClick={() => setTab("templates")}>
            <LayoutTemplate size={16} />模板
          </button>
        </div>
        <button className="dashboard-account" type="button" onClick={() => void onLogout()}>
          <LogOut size={14} />
          <span>{email}</span>
        </button>
      </nav>

      <div ref={scrollRef} className="dashboard-content" onScroll={handleScroll}>
        <header
          className="dashboard-header"
          style={{
            "--header-alpha": 0.5 + scrollAmount * 0.4,
            "--header-blur": `${8 + scrollAmount * 14}px`,
            "--header-border-alpha": scrollAmount,
          } as React.CSSProperties}
        >
          <h1>{tab === "all" ? "全部简历" : "模板"}</h1>
          <div className="dashboard-header-actions">
            {tab === "all" && (
              <label className="dashboard-search">
                <span className="visually-hidden">搜索简历</span>
                <Search size={14} aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索简历" />
              </label>
            )}
            <Button className="dashboard-create" size="sm" icon={<Plus size={14} />} onClick={() => void onCreate()}>
              新建简历
            </Button>
          </div>
        </header>

        <div className="dashboard-main">
          {tab === "templates" ? (
            <section className="home-card-grid" aria-label="简历模板">
              <ResumeThumbnailCard
                resume={{ id: "standard-template", title: "标准简历模板", updatedAt: "内置" }}
                onOpen={() => void onCreate()}
              />
            </section>
          ) : visibleResumes.length > 0 ? (
            <section className="home-card-grid" aria-label="全部简历">
              {visibleResumes.map((resume) => (
                <ResumeThumbnailCard
                  key={resume.id}
                  resume={resume}
                  onOpen={() => void onOpen(resume.id)}
                  onDelete={() => requestDelete(resume)}
                  deleteDisabled={pendingDelete !== null}
                />
              ))}
            </section>
          ) : (
            <section className="dashboard-empty-state">
              <PenLine size={48} strokeWidth={1.2} />
              <h2>{query ? "没有匹配的简历" : "您还没有简历"}</h2>
              <p>{query ? "换个关键词试试。" : "创建一个新的文档，开始您的创作之旅。"}</p>
              {!query && (
                <Button icon={<Plus size={16} />} onClick={() => void onCreate()}>
                  创建第一份简历
                </Button>
              )}
            </section>
          )}
        </div>

        {pendingDelete && (
          <div className="home-delete-toast">
            <Toast>
              <span>已删除「{pendingDelete.title}」</span>
              <Button variant="text" onClick={undoDelete}>撤销</Button>
            </Toast>
          </div>
        )}
      </div>
    </main>
  );
}

export function HomePage() {
  const user = useResumeStore((state) => state.user);
  const resumes = useResumeStore((state) => state.resumes);
  const createResume = useResumeStore((state) => state.createResume);
  const deleteResume = useResumeStore((state) => state.deleteResume);
  const logout = useResumeStore((state) => state.logout);

  const createAndOpenResume = async () => {
    await createResume("未命名简历");
    const resumeId = useResumeStore.getState().activeResumeId;
    if (resumeId) navigateTo(editorPath(resumeId));
  };

  const logoutAndReturn = async () => {
    await logout();
    navigateTo("/", { replace: true });
  };

  return (
    <HomeScreen
      email={user?.email ?? ""}
      resumes={resumes}
      onCreate={createAndOpenResume}
      onOpen={(id) => navigateTo(editorPath(id))}
      onDelete={deleteResume}
      onLogout={logoutAndReturn}
    />
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

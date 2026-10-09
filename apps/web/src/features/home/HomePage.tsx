import { t, useLocale } from "@/i18n";
import { MotionPresence, useContentMotion } from "@/components/ui/motion";
import { Reveal } from "@/v3/skeletons";
import { PAGE_CACHE_DEDUPE_MS, useRevalidateOnFocus } from "@/v3/pageCache";
import { LoadingText } from "@/components/ui/page-loading";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ResumeImportSummary, type ResumeSummary } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { editorPath, navigateTo } from "../../routing";
import { ResumePreview } from "../preview/ResumePreview";
import { downloadPdfBlob, resumePdfExportErrorMessage, resumePdfFilename } from "../preview/pdfExport";
import { Icon } from "../../v3/Icon";
import { Dialog, Menu, SearchBox, Toast, type MenuItem, PageEyebrow } from "../../v3/primitives";
import { DeleteResumeArt, EmptyListArt, ImportTaskDoc, ResumeLoadErrorArt, SearchEmptyArt } from "./homeArt";
import { RenameResumeDialog } from "./RenameResumeDialog";
import { SharePanel } from "./SharePanel";
import { ResumeImportDialog } from "./ResumeImportDialog";
import { ResumeCreateDialog } from "./ResumeCreateDialog";
import { useStableCallback } from "./useStableCallback";
import "./home-v3.css";

// 每个账号最多 10 份正式简历（后端 RESUME_LIMIT_REACHED 同一口径），到上限后新建、导入、复制置灰
export const MAX_RESUMES_PER_USER = 10;

type Notice = { kind: "success" | "error"; title: string; message?: string; key: number };

function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const show = useCallback((kind: Notice["kind"], title: string, message?: string) => {
    setNotice({ kind, title, message, key: Date.now() + Math.random() });
  }, []);
  const dismiss = useCallback(() => setNotice(null), []);
  const node = notice ? <Toast key={notice.key} kind={notice.kind} title={notice.title} message={notice.message} onDismiss={dismiss} /> : null;
  return { show, node };
}

type HomeScreenProps = {
  loading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
  resumes: ResumeSummary[];
  activeImports: ResumeImportSummary[];
  failedImports: ResumeImportSummary[];
  onOpen: (id: string) => void | Promise<void>;
  onRename: (id: string, title: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onDeleteImport: (id: string) => void | Promise<void>;
  initialCreateOpen?: boolean;
  initialImportOpen?: boolean;
  initialTemplateId?: string | null;
  onCreateClose?: () => void;
  onImportClose?: () => void;
};

function importFailureStatus(task: ResumeImportSummary) {
  const uploadFailed = task.upload_status === "failed";
  const stage = uploadFailed ? t("上传失败") : t("解析失败");
  const durationMs = uploadFailed ? task.upload_duration_ms : task.parse_duration_ms;
  if (durationMs === null) return `${stage} · —`;
  if (durationMs < 1000) return t("{value0} · {value1} 毫秒", { value0: stage, value1: durationMs });
  return t("{value0} · {value1} 秒", { value0: stage, value1: (durationMs / 1000).toFixed(1) });
}

// 列表卡片的更新时间：今天显示时刻，昨天显示「昨天」，更早显示月-日
export function formatUpdatedAt(value: string, now = new Date()) {
  // 后端返回不带时区的 UTC 时间（与 SharePanel 的 parseShareExpiry 同一口径），补 Z 再换算成本地时间
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const date = new Date(hasTimezone ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.getTime();
  if (time >= startOfToday) return t("今天 {value0}:{value1}", { value0: pad(date.getHours()), value1: pad(date.getMinutes()) });
  if (time >= startOfToday - 86400000) return t("昨天");
  if (date.getFullYear() !== now.getFullYear()) return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* 02.1c 导入任务卡：解析中（不可确定进度条）/ 解析失败（红底 + 删除记录） */
function ImportTaskCard({
  task,
  failed = false,
  deleting = false,
  deleteDisabled = false,
  onDelete,
}: {
  task: ResumeImportSummary;
  failed?: boolean;
  deleting?: boolean;
  deleteDisabled?: boolean;
  onDelete?: () => void;
}) {
  useLocale();
  const stage = task.upload_status === "uploading" ? t("正在上传") : t("正在解析");
  const stateLabel = failed
    ? task.upload_status === "failed" ? t("上传失败") : t("解析失败")
    : task.upload_status === "uploading" ? t("上传中") : t("解析中");

  return (
    <article className={`hv3-card hv3-import-card${failed ? " is-failed" : ""}`} aria-label={t("导入任务 {value0}", { value0: task.source_filename })}>
      <div className="hv3-thumb">
        <ImportTaskDoc />
        <div className="hv3-task-state">
          <span className="hv3-task-state-label">{stateLabel}</span>
          {!failed && (
            <span
              className="hv3-task-progress"
              role="progressbar"
              aria-label={`${task.source_filename} ${stage}`}
              aria-valuetext={t("{value0}，暂时无法估算完成时间", { value0: stage })}
            >
              <span />
            </span>
          )}
        </div>
      </div>
      <div className="hv3-card-meta">
        <strong title={task.source_filename}>{task.source_filename}</strong>
        <div className="hv3-card-sub">
          <small className={failed ? "is-danger" : undefined}>{failed ? importFailureStatus(task) : t("{value0} · 请稍候", { value0: stage })}</small>
          {failed && onDelete && (
            <button
              type="button"
              className="v3-btn v3-btn-ghost hv3-task-delete"
              disabled={deleteDisabled}
              aria-label={t("删除失败记录 {value0}", { value0: task.source_filename })}
              onClick={onDelete}
            >
              {deleting ? t("正在删除…") : t("删除记录")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/* 02.1 简历卡：灰底预览框 + 纸张缩略图 + 标题 / 更新时间，右上角 ⋯ 菜单 */
function ResumeCard({
  resume,
  atLimit,
  deleteDisabled,
  onOpen,
  onRename,
  onShare,
  onDelete,
  onNotice,
}: {
  resume: ResumeSummary;
  atLimit: boolean;
  deleteDisabled: boolean;
  onOpen: () => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
  onNotice: (kind: "success" | "error", title: string, message?: string) => void;
}) {
  useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyRequestId, setCopyRequestId] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }, []);

  // 复制为新简历：沿用原有的锁版本 + 稳定请求 ID，失败可以原样重试
  const copy = async (title: string) => {
    if (!copyRequestId || copying) return;
    const ownerId = useResumeStore.getState().user?.id;
    setCopying(true);
    try {
      const { resume: copied } = await api.copyResume(resume.id, { title, base_lock_version: resume.lock_version, client_request_id: copyRequestId });
      if (useResumeStore.getState().user?.id !== ownerId) return;
      useResumeStore.setState((state) => ({ resumes: [copied, ...state.resumes.filter((item) => item.id !== copied.id)] }));
      setCopyRequestId(null);
      try {
        await useResumeStore.getState().listResumes();
        onNotice("success", t("已复制为「{value0}」", { value0: title }));
      } catch {
        onNotice("error", t("副本已创建，列表预览刷新失败，请刷新页面；无需再次复制。"));
      }
    } catch {
      onNotice("error", t("复制失败，请检查名称、简历数量或刷新后重试。"));
    } finally {
      setCopying(false);
    }
  };

  const exportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await api.downloadResumePdf(resume.id, resume.lock_version);
      downloadPdfBlob(result.blob, resumePdfFilename(result.filename, resume.title));
    } catch (reason) {
      const message = resumePdfExportErrorMessage(reason);
      if (message) onNotice("error", message);
    } finally {
      setExporting(false);
    }
  };

  const items: MenuItem[] = [
    { label: t("打开编辑"), icon: "edit", onSelect: onOpen },
    { label: t("重命名"), icon: "text", onSelect: onRename },
    {
      label: t("复制为新简历"),
      icon: "copy",
      disabled: atLimit,
      title: atLimit ? t("已达 {value0} 份上限", { value0: MAX_RESUMES_PER_USER }) : undefined,
      onSelect: () => setCopyRequestId(crypto.randomUUID()),
    },
    { label: t("分享链接"), icon: "link", onSelect: onShare },
    { label: exporting ? t("正在导出…") : t("导出 PDF"), icon: "dl", disabled: exporting, onSelect: () => void exportPdf() },
    { kind: "separator" },
    { label: t("删除"), icon: "trash", danger: true, disabled: deleteDisabled, onSelect: onDelete },
  ];

  return (
    <article className="hv3-card">
      <div className="hv3-thumb">
        <button className="hv3-thumb-open" type="button" aria-label={t("打开 {value0}", { value0: resume.title })} onClick={onOpen}>
          <span className="hv3-paper" aria-hidden="true">
            {resume.preview?.layout_plan ? (
              <ResumePreview data={resume.preview.data} style={resume.preview.style} layoutPlan={resume.preview.layout_plan} firstPageOnly />
            ) : (
              <span className="hv3-paper-unavailable">{t("预览不可用")}</span>
            )}
          </span>
        </button>
        <button
          ref={triggerRef}
          type="button"
          className="v3-icon-btn hv3-card-more"
          aria-label={t("更多简历操作 {value0}", { value0: resume.title })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name="more" size={16} />
        </button>
        <Menu anchorRef={triggerRef} open={menuOpen} onClose={closeMenu} items={items} placement="bottom-end" label={t("{value0} 操作菜单", { value0: resume.title })} width={168} />
      </div>
      <div className="hv3-card-meta">
        <strong title={resume.title}>{resume.title}</strong>
        <div className="hv3-card-sub">
          <small className="v3-num">{formatUpdatedAt(resume.updated_at)}{t(" · 已保存")}</small>
        </div>
      </div>
      <MotionPresence>{copyRequestId && (
        <RenameResumeDialog
          copying
          initialTitle={t("{value0} 副本", { value0: resume.title })}
          busy={copying}
          onCancel={() => setCopyRequestId(null)}
          onSubmit={copy}
        />
      )}</MotionPresence>
    </article>
  );
}

/* 02.1f 删除确认：插图 + 标题 + 影响说明 + 两个等宽按钮（红色删除） */
function DeleteResumeDialog({ resume, busy, onCancel, onConfirm }: { resume: ResumeSummary; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  useLocale();
  const close = useStableCallback(onCancel);
  return (
    <Dialog width={420} label={t("删除这份简历？")} onClose={close} className="v3-confirm hv3-delete" closable={!busy}>
      <div className="v3-dialog-body">
        <div className="v3-stage has-dots"><DeleteResumeArt /></div>
        <h2 className="v3-dialog-title">{t("删除这份简历？")}</h2>
        <p className="v3-dialog-sub hv3-delete-sub" title={resume.title}>{resume.title}{t(" · 删除后无法恢复")}</p>
        <ul className="hv3-delete-impact">
          <li><Icon name="link" size={14} />{t("公开分享链接会立即失效")}</li>
          <li><Icon name="brief" size={14} />{t("关联的求职记录会解除关联")}</li>
          <li><Icon name="doc" size={14} />{t("其他简历不受影响")}</li>
        </ul>
      </div>
      <div className="v3-confirm-foot">
        <button type="button" className="v3-btn v3-btn-ghost" disabled={busy} onClick={onCancel}>{t("取消")}</button>
        <button type="button" className="v3-btn v3-btn-danger" disabled={busy} onClick={onConfirm} data-autofocus>
          {busy ? t("正在删除…") : t("删除")}
        </button>
      </div>
    </Dialog>
  );
}

export function HomeScreen({
  loading = false,
  loadError = false,
  onRetry,
  resumes,
  activeImports,
  failedImports,
  onOpen,
  onRename,
  onDelete,
  onDeleteImport,
  initialCreateOpen = false,
  initialImportOpen = false,
  initialTemplateId = null,
  onCreateClose,
  onImportClose,
}: HomeScreenProps) {
  useLocale();
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ResumeSummary | null>(null);
  const [pendingRename, setPendingRename] = useState<ResumeSummary | null>(null);
  const [copyFromRename, setCopyFromRename] = useState<{ resume: ResumeSummary; requestId: string } | null>(null);
  const [copyingFromRename, setCopyingFromRename] = useState(false);
  const [sharingResume, setSharingResume] = useState<ResumeSummary | null>(null);
  const [deletingResumeId, setDeletingResumeId] = useState<string | null>(null);
  const [renamingResumeId, setRenamingResumeId] = useState<string | null>(null);
  const [deletingImportId, setDeletingImportId] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(initialImportOpen);
  const [createDialogOpen, setCreateDialogOpen] = useState(initialCreateOpen);
  const notice = useNotice();

  const atLimit = resumes.length >= MAX_RESUMES_PER_USER;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleResumes = useMemo(
    () => resumes.filter((resume) => resume.title.toLocaleLowerCase().includes(normalizedQuery)),
    [normalizedQuery, resumes],
  );
  const visibleImports = useMemo(() => [
    ...activeImports.map((task) => ({ task, failed: false })),
    ...failedImports.map((task) => ({ task, failed: true })),
  ].filter(({ task }) => task.source_filename.toLocaleLowerCase().includes(normalizedQuery)), [activeImports, failedImports, normalizedQuery]);
  const hasAnything = resumes.length + activeImports.length + failedImports.length > 0;
  const visibleCardCount = visibleImports.length + visibleResumes.length;
  // 搜索结果集合变化时（而不是每敲一个字），网格浮上淡入
  const gridMotionRef = useContentMotion<HTMLElement>(visibleResumes.map((resume) => resume.id).join(","), { initial: false });

  const closeCreate = () => {
    setCreateDialogOpen(false);
    onCreateClose?.();
  };
  const closeImport = () => {
    setImportDialogOpen(false);
    onImportClose?.();
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deletingResumeId) return;
    const resume = pendingDelete;
    setDeletingResumeId(resume.id);
    try {
      await onDelete(resume.id);
      notice.show("success", t("已删除「{value0}」", { value0: resume.title }));
    } catch {
      notice.show("error", t("删除「{value0}」失败，请稍后重试。", { value0: resume.title }));
    } finally {
      setDeletingResumeId(null);
      setPendingDelete(null);
    }
  };

  const confirmRename = async (title: string) => {
    if (!pendingRename || renamingResumeId) return;
    const resume = pendingRename;
    if (title === resume.title) {
      setPendingRename(null);
      return;
    }
    setRenamingResumeId(resume.id);
    try {
      await onRename(resume.id, title);
      notice.show("success", t("已将简历重命名为「{value0}」", { value0: title }));
      setPendingRename(null);
    } catch {
      notice.show("error", t("保存名称失败，请刷新列表后重试。"));
    } finally {
      setRenamingResumeId(null);
    }
  };

  // 重命名弹窗里的「复制为新简历」入口：关闭重命名，打开复制
  const copyFromRenameSubmit = async (title: string) => {
    if (!copyFromRename || copyingFromRename) return;
    const { resume, requestId } = copyFromRename;
    const ownerId = useResumeStore.getState().user?.id;
    setCopyingFromRename(true);
    try {
      const { resume: copied } = await api.copyResume(resume.id, { title, base_lock_version: resume.lock_version, client_request_id: requestId });
      if (useResumeStore.getState().user?.id !== ownerId) return;
      useResumeStore.setState((state) => ({ resumes: [copied, ...state.resumes.filter((item) => item.id !== copied.id)] }));
      setCopyFromRename(null);
      try {
        await useResumeStore.getState().listResumes();
        notice.show("success", t("已复制为「{value0}」", { value0: title }));
      } catch {
        notice.show("error", t("副本已创建，列表预览刷新失败，请刷新页面；无需再次复制。"));
      }
    } catch {
      notice.show("error", t("复制失败，请检查名称、简历数量或刷新后重试。"));
    } finally {
      setCopyingFromRename(false);
    }
  };

  const deleteFailedImport = async (task: ResumeImportSummary) => {
    if (deletingImportId) return;
    setDeletingImportId(task.id);
    try {
      await onDeleteImport(task.id);
      notice.show("success", t("已删除「{value0}」的失败记录", { value0: task.source_filename }));
    } catch {
      notice.show("error", t("删除“{value0}”的失败记录失败，请稍后重试。", { value0: task.source_filename }));
    } finally {
      setDeletingImportId(null);
    }
  };

  const limitHint = t("已达 {value0} 份上限", { value0: MAX_RESUMES_PER_USER });
  const showEmptyList = !loading && !loadError && !hasAnything;

  return (
    <div className="hv3-page">
      <header className="hv3-head">
        <div className="hv3-head-copy">
          <PageEyebrow className="hv3-eyebrow" segments={["RESUMES", !loadError && <Reveal inline loading={loading} placeholder={<LoadingText width={36} />}>{t("{value0} 份", { value0: resumes.length })}</Reveal>]} />
          <h1 className="hv3-title">{t("我的简历")}</h1>
          <Reveal loading={loading} placeholder={<p className="hv3-sub"><LoadingText width={320} /></p>}>{atLimit ? (
            <p className="hv3-sub is-warn">{t("已达到 ")}{MAX_RESUMES_PER_USER}{t(" 份上限。删除不用的简历后，才能新建、导入或复制。")}</p>
          ) : (
            <p className="hv3-sub">{t("每份简历独立编辑，需要时复制一份按岗位修改。")}</p>
          )}</Reveal>
        </div>
        {!showEmptyList && (
          <div className="hv3-head-actions">
            <button type="button" className="v3-btn v3-btn-ghost hv3-btn-import" disabled={atLimit} title={atLimit ? limitHint : undefined} onClick={() => setImportDialogOpen(true)}>
              <Icon name="upload" size={13} />{t("导入简历")}</button>
            <button type="button" className="v3-btn v3-btn-dark hv3-btn-new" disabled={atLimit} title={atLimit ? limitHint : undefined} onClick={() => setCreateDialogOpen(true)}>
              <Icon name="plus" size={13} />{t("新建简历")}</button>
          </div>
        )}
      </header>

      {loadError ? (
        <>
          <div className="hv3-divider is-error" />
          <section className="hv3-load-error" role="alert">
            <div className="v3-stage"><ResumeLoadErrorArt /></div>
            <h3>{t("简历列表没能加载出来")}</h3>
            <p>{t("网络不稳定或服务暂时不可用，你的简历都还在，刷新一下试试。")}</p>
            <button type="button" className="v3-btn v3-btn-ghost" onClick={onRetry}><Icon name="refresh" size={13} />{t("重新加载")}</button>
          </section>
        </>
      ) : showEmptyList ? (
        <>
          <div className="hv3-divider is-empty" />
          <section className="v3-empty hv3-empty is-list" aria-label={t("还没有简历")}>
            <div className="v3-stage has-dots"><EmptyListArt /></div>
            <h3>{t("从第一份简历开始")}</h3>
            <p>{t("新建时选一套模板、起个名字；已有简历文件可以用「导入简历」。")}</p>
            <div className="v3-empty-actions">
              <button type="button" className="v3-btn v3-btn-dark is-lg hv3-empty-new" onClick={() => setCreateDialogOpen(true)}>{t("新建简历")}<Icon name="arrow" size={12} />
              </button>
              <button type="button" className="v3-link" onClick={() => setImportDialogOpen(true)}>
                <Icon name="upload" size={13} />{t("导入简历")}</button>
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="hv3-toolbar">
            <h2 className="hv3-toolbar-title">{t("全部简历 ")}<span className="v3-num"><Reveal inline loading={loading} placeholder={<LoadingText width={20} />}>{resumes.length}</Reveal></span></h2>
            <SearchBox value={query} onChange={setQuery} placeholder={t("搜索简历…")} label={t("搜索简历")} width={220} />
          </div>
          <div className="hv3-divider" />
          <Reveal loading={loading} className="hv3-grid-slot" placeholder={(
            <div className="hv3-grid" role="status" aria-label={t("正在加载我的简历…")}>
              {[0, 1, 2, 3].map((index) => (
                <div className="hv3-card is-skeleton" key={index} aria-hidden="true">
                  <div className="hv3-thumb" />
                  <div className="hv3-card-meta"><span className="hv3-sk is-title" /><span className="hv3-sk" /></div>
                </div>
              ))}
            </div>
          )}>{visibleCardCount > 0 ? (
            <section ref={gridMotionRef} className="hv3-grid" aria-label={t("全部简历")}>
              {visibleImports.map(({ task, failed }) => (
                <ImportTaskCard
                  key={task.id}
                  task={task}
                  failed={failed}
                  deleting={deletingImportId === task.id}
                  deleteDisabled={deletingImportId !== null}
                  onDelete={failed ? () => void deleteFailedImport(task) : undefined}
                />
              ))}
              {visibleResumes.map((resume) => (
                <ResumeCard
                  key={resume.id}
                  resume={resume}
                  atLimit={atLimit}
                  deleteDisabled={deletingResumeId !== null}
                  onOpen={() => void onOpen(resume.id)}
                  onRename={() => setPendingRename(resume)}
                  onShare={() => setSharingResume(resume)}
                  onDelete={() => setPendingDelete(resume)}
                  onNotice={notice.show}
                />
              ))}
              {!normalizedQuery && (
                <button
                  type="button"
                  className="hv3-new-card"
                  disabled={atLimit}
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Icon name="plus" size={20} />
                  <span>{atLimit ? limitHint : t("新建空白简历")}</span>
                </button>
              )}
            </section>
          ) : (
            <section className="v3-empty hv3-empty is-search" aria-label={t("搜索结果")}>
              <div className="v3-stage has-dots"><SearchEmptyArt /></div>
              <h3>{t("没有找到「")}{query.trim()}」</h3>
              <p>{t("试试更短的关键词，比如公司名或岗位名；也可以回到「全部」查看所有简历。")}</p>
              <div className="v3-empty-actions">
                <button type="button" className="v3-btn v3-btn-ghost is-lg hv3-clear-search" onClick={() => setQuery("")}>
                  <Icon name="search" size={13} />{t("清除搜索")}</button>
              </div>
            </section>
          )}</Reveal>
        </>
      )}

      {notice.node}
      <MotionPresence>{pendingDelete && (
        <DeleteResumeDialog
          resume={pendingDelete}
          busy={deletingResumeId === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}</MotionPresence>
      <MotionPresence>{pendingRename && (
        <RenameResumeDialog
          initialTitle={pendingRename.title}
          busy={renamingResumeId === pendingRename.id}
          copyDisabled={atLimit}
          onCancel={() => setPendingRename(null)}
          onSubmit={confirmRename}
          onCopy={() => {
            const resume = pendingRename;
            setPendingRename(null);
            setCopyFromRename({ resume, requestId: crypto.randomUUID() });
          }}
        />
      )}</MotionPresence>
      <MotionPresence>{copyFromRename && (
        <RenameResumeDialog
          copying
          initialTitle={t("{value0} 副本", { value0: copyFromRename.resume.title })}
          busy={copyingFromRename}
          onCancel={() => setCopyFromRename(null)}
          onSubmit={copyFromRenameSubmit}
        />
      )}</MotionPresence>
      <MotionPresence>{sharingResume && (
        <SharePanel resumeId={sharingResume.id} resumeTitle={sharingResume.title} onClose={() => setSharingResume(null)} />
      )}</MotionPresence>
      <MotionPresence>{importDialogOpen && (
        <ResumeImportDialog
          onClose={closeImport}
          onAccepted={(title) => notice.show("success", t("已开始导入「{value0}」", { value0: title }), t("解析完成后会出现在列表里"))}
        />
      )}</MotionPresence>
      <MotionPresence>{createDialogOpen && <ResumeCreateDialog onClose={closeCreate} initialTemplateId={initialTemplateId} />}</MotionPresence>
    </div>
  );
}

export function HomePage({
  initialCreateOpen = false,
  initialImportOpen = false,
  initialTemplateId = null,
  onCreateClose,
  onImportClose,
}: {
  initialCreateOpen?: boolean;
  initialImportOpen?: boolean;
  initialTemplateId?: string | null;
  onCreateClose?: () => void;
  onImportClose?: () => void;
} = {}) {
  useLocale();
  // 本次登录已经读过简历列表时直接显示（不画骨架）；距上次读取不到 5 分钟不再请求，否则后台静默刷新
  const [loading, setLoading] = useState(() => useResumeStore.getState().resumesLoadedAt === null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const resumes = useResumeStore((state) => state.resumes);
  const activeImports = useResumeStore((state) => state.activeImports);
  const failedImports = useResumeStore((state) => state.failedImports);
  const listResumes = useResumeStore((state) => state.listResumes);
  const pollResumeImport = useResumeStore((state) => state.pollResumeImport);
  const deleteResume = useResumeStore((state) => state.deleteResume);
  const renameResume = useResumeStore((state) => state.renameResume);
  const deleteResumeImport = useResumeStore((state) => state.deleteResumeImport);

  useEffect(() => {
    let cancelled = false;
    const loadedAt = useResumeStore.getState().resumesLoadedAt;
    if (loadAttempt === 0 && loadedAt !== null && Date.now() - loadedAt < PAGE_CACHE_DEDUPE_MS) {
      setLoading(false);
      return undefined;
    }
    if (loadedAt === null || loadAttempt > 0) setLoading(true);
    setLoadError(false);
    void listResumes()
      // 后台刷新失败时保留已有列表，只有从来没读到过才显示失败状态
      .catch(() => { if (!cancelled && (loadedAt === null || loadAttempt > 0)) setLoadError(true); })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listResumes, loadAttempt]);
  // 窗口回到前台：后台静默刷新列表（失败时保留已有列表）
  useRevalidateOnFocus(() => { void listResumes().catch(() => undefined); });

  return (
    <>
      {activeImports
        .filter((task) => task.upload_status === "succeeded" && task.parse_status === "processing")
        .map((task) => (
          <ResumeImportPoller key={task.id} importId={task.id} pollResumeImport={pollResumeImport} />
        ))}
      <HomeScreen
        loading={loading}
        loadError={loadError}
        onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
        resumes={resumes}
        activeImports={activeImports}
        failedImports={failedImports}
        onOpen={(id) => navigateTo(editorPath(id))}
        onRename={renameResume}
        onDelete={deleteResume}
        onDeleteImport={deleteResumeImport}
        initialCreateOpen={initialCreateOpen}
        initialImportOpen={initialImportOpen}
        initialTemplateId={initialTemplateId}
        onCreateClose={onCreateClose}
        onImportClose={onImportClose}
      />
    </>
  );
}

const RESUME_IMPORT_POLL_INTERVAL_MS = 1000;

function ResumeImportPoller({ importId, pollResumeImport }: { importId: string; pollResumeImport: (id: string) => Promise<void> }) {
  useLocale();
  useEffect(() => {
    let requestInFlight = false;
    const timer = window.setInterval(() => {
      if (requestInFlight) return;
      requestInFlight = true;
      void pollResumeImport(importId)
        .catch(() => {
          // 轮询偶发失败时下一次 tick 自动重试
        })
        .finally(() => {
          requestInFlight = false;
        });
    }, RESUME_IMPORT_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [importId, pollResumeImport]);

  return null;
}

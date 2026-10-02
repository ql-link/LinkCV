import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { MotionPresence, useContentMotion } from "../../components/ui/motion";

import { api, ApiRequestError, type ResumeTemplate } from "../../api/client";
import { LoadingText } from "@/components/ui/page-loading";
import { Reveal, Sk, SkeletonGrid } from "@/v3/skeletons";
import { PAGE_CACHE_STATIC_MS, readPageCache, useRevalidateOnFocus, writePageCache } from "@/v3/pageCache";
import { editorPath, navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import { Icon } from "../../v3/Icon";
import { Badge, MiniResume } from "../../v3/art";
import { Dialog, DialogFooter, PageEyebrow } from "../../v3/primitives";
import { TemplateThumbnail } from "./TemplateThumbnail";
import { TemplatePreviewDialog } from "./TemplatePreviewDialog";
import { V3TemplateFilter } from "./TemplateFilterPopover";
import { formatTemplateUses } from "./templateUses";
import "./template-filter.css";

const TEMPLATES_CACHE_KEY = "templates";

function followAppLink(event: MouseEvent<HTMLAnchorElement>, path: string) {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  navigateTo(path);
}

function createErrorMessage(error: unknown) {
  if (!(error instanceof ApiRequestError)) return "创建简历失败，请稍后重试。";
  if (error.message === "INVALID_RESUME_TITLE") return "请输入 1–255 个字符的简历名称。";
  if (error.message === "RESUME_TITLE_CONFLICT") return "该名称已经存在，请换一个名称。";
  if (error.message === "RESUME_LIMIT_REACHED") return "简历数量已达上限，请先清理已有简历。";
  if (error.message === "TEMPLATE_INACTIVE") return "所选模板已不可用，请重新选择。";
  return "创建简历失败，请稍后重试。";
}

// 空结果说明里点出冲突的条件（状态变体 ② 规则 1）
function filterConflictText(styles: string[], useCases: string[]) {
  const quote = (values: string[]) => values.map((value) => `「${value}」`).join("");
  if (styles.length && useCases.length) return `${quote(styles)}风格和${quote(useCases)}场景同时选中时没有模板。试试减少一个筛选条件。`;
  if (styles.length) return `${quote(styles)}风格下没有模板。试试换一个筛选条件。`;
  return `${quote(useCases)}场景下没有模板。试试换一个筛选条件。`;
}

export function ResumeTemplatesPage() {
  const createResume = useResumeStore((state) => state.createResume);
  const pageRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // 模板列表很少变化：回到本页时先用缓存直接显示，5 分钟内不再请求，超过后在后台静默刷新
  const [templates, setTemplates] = useState<ResumeTemplate[]>(() => readPageCache<ResumeTemplate[]>(TEMPLATES_CACHE_KEY)?.value ?? []);
  const [loading, setLoading] = useState(() => !readPageCache(TEMPLATES_CACHE_KEY));
  const [failed, setFailed] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<ResumeTemplate | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ResumeTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [selectedUseCases, setSelectedUseCases] = useState<string[]>([]);

  // 筛选规则沿用原实现：组内任选其一（OR），两组之间同时满足（AND）
  // Keep the catalog's curated order; mock usage statistics do not rank designs.
  const filteredTemplates = useMemo(() => templates
    .filter((template) =>
      (selectedStyles.length === 0 || selectedStyles.some((style) => template.style_categories?.includes(style)))
      && (selectedUseCases.length === 0 || selectedUseCases.some((useCase) => template.use_cases?.includes(useCase)))),
  [templates, selectedStyles, selectedUseCases]);
  const hasFilters = selectedStyles.length + selectedUseCases.length > 0;
  // 筛选条件变化时，模板网格浮上淡入
  const gridMotionRef = useContentMotion<HTMLElement>(`${selectedStyles.join(",")}|${selectedUseCases.join(",")}`, { initial: false });

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    let width = window.innerWidth;
    let settleTimer: number | undefined;
    const onResize = () => {
      if (width === window.innerWidth) return;
      width = window.innerWidth;
      // Reuse thumbnail layers during a width drag, then raster at the final
      // scale once it settles. This avoids both per-frame raster work and blur.
      if (!page.hasAttribute("data-resizing")) page.setAttribute("data-resizing", "");
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => page.removeAttribute("data-resizing"), 200);
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(settleTimer);
      page.removeAttribute("data-resizing");
    };
  }, []);

  const applyFilters = (styles: string[], useCases: string[]) => {
    setSelectedStyles(styles);
    setSelectedUseCases(useCases);
  };

  const loadTemplates = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) setLoading(true);
    setFailed(false);
    try {
      const result = await api.listResumeTemplates();
      setTemplates(result.templates);
      writePageCache(TEMPLATES_CACHE_KEY, result.templates);
    } catch {
      // 后台刷新失败时保留已显示的模板
      if (!background) setFailed(true);
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = readPageCache(TEMPLATES_CACHE_KEY, PAGE_CACHE_STATIC_MS);
    if (cached?.fresh) return;
    void loadTemplates({ background: Boolean(cached) });
  }, [loadTemplates]);
  useRevalidateOnFocus(() => {
    if (!readPageCache(TEMPLATES_CACHE_KEY, PAGE_CACHE_STATIC_MS)?.fresh) void loadTemplates({ background: true });
  });

  const closeCreateDialog = () => {
    if (submitting) return;
    setSelectedTemplate(null);
    setTitle("");
    setCreateError(null);
  };

  // 预览里点「创建简历」：关闭预览，打开命名弹窗
  const openCreateDialog = (template: ResumeTemplate) => {
    setPreviewTemplate(null);
    setSelectedTemplate(template);
    setTitle("");
    setCreateError(null);
  };

  const submitCreate = async () => {
    if (!selectedTemplate || submitting) return;
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setCreateError("请输入简历名称。");
      queueMicrotask(() => titleInputRef.current?.focus());
      return;
    }

    setSubmitting(true);
    setCreateError(null);
    try {
      const resumeId = await createResume(normalizedTitle, selectedTemplate.id);
      navigateTo(editorPath(resumeId));
    } catch (error) {
      setCreateError(createErrorMessage(error));
      queueMicrotask(() => titleInputRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  };

  const ready = !loading && !failed;

  return (
    <div ref={pageRef} className="v3-page tpl-page">
      <PageEyebrow segments={["TEMPLATES", <><Reveal inline loading={loading} placeholder={<LoadingText width={16} />}>{ready ? templates.length : "–"}</Reveal> 套</>]} />
      <h1 className="v3-page-title">简历模板</h1>
      <p className="v3-page-sub">浏览当前可用版式，选择后填写简历名称并进入编辑器。</p>


      {!loading && failed && (
        <div className="v3-empty is-error tpl-empty" role="alert">
          <div className="v3-stage has-dots">
            <MiniResume x={176} y={20} w={72} h={96} rotate={-4} style={{ opacity: 0.6 }} />
            <Badge x={234} y={82} icon="refresh" size={26} />
          </div>
          <h3>模板暂时无法加载</h3>
          <p>请检查网络后重试，已有简历不会受到影响。</p>
          <div className="v3-empty-actions">
            <button type="button" className="v3-btn v3-btn-ghost is-lg" onClick={() => void loadTemplates()}>
              <Icon name="refresh" size={13} />
              重新加载
            </button>
          </div>
        </div>
      )}

      {/* ③ 当前没有可用模板：后台一个模板都没启用 */}
      {ready && templates.length === 0 && (
        <div className="v3-empty tpl-empty is-none">
          <div className="v3-stage has-dots">
            {[[146, -8], [210, 0], [274, 8]].map(([x, rotate]) => (
              <span key={x} className="tpl-slot" style={{ left: x, transform: rotate ? `rotate(${rotate}deg)` : undefined }} aria-hidden="true">
                <i style={{ top: 14, width: 34, height: 5 }} />
                <i style={{ top: 26, width: 54, height: 3 }} />
              </span>
            ))}
          </div>
          <h3>当前没有可用模板</h3>
          <p>模板启用后会显示在这里，你仍可以从已有简历继续编辑。</p>
          <div className="v3-empty-actions">
            <a className="v3-btn v3-btn-ghost is-lg" href="/resumes" onClick={(event) => followAppLink(event, "/resumes")}>
              <Icon name="doc" size={13} />
              返回全部简历
            </a>
          </div>
        </div>
      )}

      {(loading || (ready && templates.length > 0)) && (
        <Reveal
          loading={loading}
          className="tpl-body"
          placeholder={(
            <>
              <div className="tpl-toolbar" aria-hidden="true"><Sk w={96} h={12} /><Sk w={88} h={30} r={8} style={{ marginLeft: "auto" }} /></div>
              <SkeletonGrid label="正在加载简历模板…" className="tpl-grid" />
            </>
          )}
        >
          <div className="tpl-toolbar">
            <span className="tpl-summary" aria-live="polite">找到 {filteredTemplates.length} 套模板</span>
            {hasFilters && (
              <button type="button" className="tpl-clear" onClick={() => applyFilters([], [])}>清除筛选</button>
            )}
            <span className="tpl-sort">
              <span>按展示顺序</span>
            </span>
            <V3TemplateFilter styles={selectedStyles} useCases={selectedUseCases} onChange={applyFilters} />
          </div>

          {filteredTemplates.length > 0 ? (
            <section ref={gridMotionRef} className="tpl-grid" aria-label="可用简历模板">
              {filteredTemplates.map((template) => (
                <article className="tpl-card" key={template.id}>
                  {/* 整张卡片可点，打开 03.1a 模板预览 */}
                  <button
                    type="button"
                    className="tpl-card-trigger"
                    aria-label={`查看模板：${template.name}`}
                    aria-haspopup="dialog"
                    onClick={() => setPreviewTemplate(template)}
                  />
                  <div className="tpl-card-cover" aria-hidden="true">
                    <TemplateThumbnail template={template} />
                  </div>
                  <h3 className="tpl-card-name">{template.name}</h3>
                  <div className="tpl-card-meta">
                    {template.style_categories?.map((style) => <span key={`style-${style}`} className="v3-chip">{style}</span>)}
                    {template.use_cases?.map((useCase) => <span key={`case-${useCase}`} className="v3-chip">{useCase}</span>)}
                    {typeof template.use_count === "number" && <span className="tpl-card-uses">{formatTemplateUses(template.use_count)} 使用</span>}
                  </div>
                </article>
              ))}
            </section>
          ) : (
            // ② 没有符合条件的模板
            <div className="v3-empty tpl-empty is-filtered">
              <div className="v3-stage has-dots">
                <MiniResume x={140} y={34} w={84} h={114} rotate={-7} accent="#3b8a6a" style={{ opacity: 0.45 }} />
                <MiniResume x={280} y={34} w={84} h={114} rotate={7} accent="#2f5bb7" style={{ opacity: 0.45 }} />
                <MiniResume x={206} y={26} w={92} h={124} style={{ opacity: 0.8 }} />
                <span className="tpl-funnel" aria-hidden="true"><Icon name="filter" size={24} /></span>
                <span className="tpl-funnel-count" aria-hidden="true">{selectedStyles.length + selectedUseCases.length}</span>
              </div>
              <h3>没有符合条件的模板</h3>
              <p>{filterConflictText(selectedStyles, selectedUseCases)}</p>
              <div className="v3-empty-actions">
                <button type="button" className="v3-btn v3-btn-ghost is-lg" onClick={() => applyFilters([], [])}>
                  <Icon name="filter" size={13} />
                  清除筛选
                </button>
              </div>
            </div>
          )}
        </Reveal>
      )}

      <MotionPresence>{previewTemplate && <TemplatePreviewDialog
        templates={filteredTemplates}
        template={previewTemplate}
        primaryActionLabel="创建简历"
        onTemplateChange={setPreviewTemplate}
        onPrimaryAction={openCreateDialog}
        onClose={() => setPreviewTemplate(null)}
      />}</MotionPresence>

      {/* 命名弹窗：沿用原有「从模板创建简历」流程，创建成功后进入编辑器 */}
      <Dialog open={selectedTemplate !== null} width={440} label="创建简历" onClose={closeCreateDialog} closable={!submitting}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitCreate();
          }}
        >
          <div className="v3-dialog-body">
            <h2 className="v3-dialog-title">创建简历</h2>
            <p className="v3-dialog-sub">基于“{selectedTemplate?.name}”创建简历，输入一个便于识别的名称。</p>
            <label className="v3-field tpl-create-field">
              <span className="v3-field-label">简历名称</span>
              <input
                ref={titleInputRef}
                id="template-resume-title"
                className="v3-input"
                name="resume-title"
                autoComplete="off"
                maxLength={255}
                placeholder="例如：2026 产品经理简历"
                value={title}
                aria-invalid={createError ? "true" : undefined}
                disabled={submitting}
                data-autofocus
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (createError) setCreateError(null);
                }}
              />
              {createError && <span className="v3-field-error" role="alert">{createError}</span>}
            </label>
          </div>
          <DialogFooter>
            <button type="button" className="v3-btn v3-btn-ghost" disabled={submitting} onClick={closeCreateDialog}>取消</button>
            <button type="submit" className="v3-btn v3-btn-dark" disabled={submitting}>
              {submitting ? "正在创建…" : "确认创建"}
            </button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}

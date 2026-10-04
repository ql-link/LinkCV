import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "@/i18n";
import { api, type InterviewAssetRecord, type JobApplicationSummary } from "@/api/client";
import { Icon } from "@/v3/Icon";
import { Menu, type MenuItem } from "@/v3/primitives";
import type { ApplicationDetailModel, DetailAction, DetailTone } from "./applicationDetailModel";
import { formatMonthDay } from "./applicationDetailModel";
import "./applicationProgressPage.css";

const HISTORY_VISIBLE = 4;

function fileBadge(name: string): string {
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.slice(0, 4).toUpperCase() : "DOC";
}

function Chip({ label, tone }: { label: string; tone: DetailTone }) {
  return <span className={`ap-chip is-${tone}`}>{label}</span>;
}

export type ApplicationProgressMenu = {
  onEditDelivery?: () => void;
  onManageResources: () => void;
  onArchive?: () => void;
  onTerminate?: () => void;
  onDelete?: () => void;
};

export function ApplicationProgressPage({
  application,
  model,
  latestRecordedSessionId,
  menu,
  busy,
  onBack,
  onOpenJob,
  onToggleFavorite,
  onAction,
  onOpenSession,
  onOfferCardAction,
}: {
  application: JobApplicationSummary;
  model: ApplicationDetailModel;
  latestRecordedSessionId: string | null;
  menu: ApplicationProgressMenu;
  busy: boolean;
  onBack: () => void;
  onOpenJob: () => void;
  onToggleFavorite: () => void;
  onAction: (action: DetailAction) => void;
  onOpenSession: (sessionId: string) => void;
  onOfferCardAction: () => void;
}) {
  useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [assets, setAssets] = useState<InterviewAssetRecord[]>([]);
  const menuRef = useRef<HTMLButtonElement>(null);
  const snapshot = application.job_snapshot;
  const snapshotText = (...keys: string[]) => keys.map((key) => snapshot[key]).find((value) => typeof value === "string" && value) as string | undefined;
  const employment = snapshot.employment_type === "full_time"
    ? t("正式")
    : snapshot.employment_type === "campus"
      ? t("校招")
      : snapshot.employment_type === "internship"
        ? t("实习")
        : null;
  const summary = [snapshotText("work_city", "city", "location"), snapshotText("salary_text", "salary")].filter(Boolean).join(" · ");

  useEffect(() => {
    let live = true;
    setAssets([]);
    if (latestRecordedSessionId) {
      void api.getInterviewSession(latestRecordedSessionId)
        .then((detail) => { if (live) setAssets(detail.assets); })
        .catch(() => undefined);
    }
    return () => { live = false; };
  }, [latestRecordedSessionId]);

  const menuItems: MenuItem[] = [
    ...(menu.onEditDelivery ? [{ label: t("编辑投递信息"), onSelect: menu.onEditDelivery }] : []),
    { label: t("管理关联资料"), onSelect: menu.onManageResources },
    ...(menu.onArchive ? [{ label: t("归档"), title: t("从看板隐藏"), onSelect: menu.onArchive }] : []),
    ...(menu.onTerminate || menu.onDelete ? [{ kind: "separator" as const }] : []),
    ...(menu.onTerminate ? [{ label: model.pending ? t("不投了") : t("结束本次求职"), danger: true, onSelect: menu.onTerminate }] : []),
    ...(menu.onDelete ? [{ label: t("删除岗位"), danger: true, onSelect: menu.onDelete }] : []),
  ];

  const history = showAllHistory || model.history.length <= HISTORY_VISIBLE + 1
    ? model.history
    : model.history.slice(0, HISTORY_VISIBLE);
  const hiddenCount = model.history.length - history.length;
  const { next } = model;
  // The accent strip follows the status chip; the stage-name chip comes first when present.
  const accentChip = next.chips[1] ?? next.chips[0];
  const accentTone = !accentChip || accentChip.tone === "dark" ? "gray" : accentChip.tone;
  const resources = [
    ...(application.resume_id
      ? [{ key: "resume", badge: fileBadge(application.resume_title_snapshot ?? ""), name: application.resume_title_snapshot ?? t("投递简历"), meta: t("投递简历 · {value0}", { value0: formatMonthDay(application.applied_at ?? application.updated_at) }) }]
      : []),
    ...(application.job_description_id
      ? [{ key: "jd", badge: "MD", name: `${application.company_name_snapshot}_${t("岗位JD")}.md`, meta: t("岗位要求 · {value0}", { value0: formatMonthDay(application.created_at) }) }]
      : []),
    ...assets.map((asset) => ({
      key: asset.id,
      badge: fileBadge(asset.original_file_name),
      name: asset.original_file_name,
      meta: `${asset.asset_type === "audio" ? t("面试录音") : asset.asset_type === "video" ? t("面试视频") : t("面试材料")} · ${formatMonthDay(asset.created_at)}`,
    })),
    ...(application.offer_materials ?? []).map((material) => ({
      key: `offer-${material.dataset_id}`,
      badge: fileBadge(material.file_name),
      name: material.file_name,
      meta: t("Offer 材料"),
    })),
  ];

  return (
    <div className="ap-page">
      <header className="ap-header">
        <div className="ap-header-copy">
          <nav className="ap-breadcrumb" aria-label={t("面包屑")}>
            <button type="button" onClick={onBack} aria-label={t("返回岗位看板")}>{t("← 岗位看板")}</button>
            <span aria-hidden="true">/</span>
            <span>{application.company_name_snapshot}</span>
          </nav>
          <h1 aria-label={`${application.company_name_snapshot}，${application.job_title_snapshot}`}>{application.job_title_snapshot}</h1>
          <p className="ap-header-meta">
            {employment && <span className="ap-chip is-gray">{employment}</span>}
            {summary && <span>{summary}</span>}
            <span className="ap-header-faint" aria-hidden="true">·</span>
            <span className="ap-header-faint">{model.headerMeta}</span>
          </p>
        </div>
        <div className="ap-header-actions">
          <button type="button" className="ap-text-button" aria-pressed={application.is_favorite} onClick={onToggleFavorite}>
            {application.is_favorite ? t("★ 已收藏") : t("☆ 收藏")}
          </button>
          <button type="button" className="ap-outline-button" onClick={onOpenJob}>{t("岗位详情")}</button>
          <button type="button" ref={menuRef} className="ap-more-button" aria-label={t("更多操作")} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            <Icon name="more" size={14} />
          </button>
          <Menu anchorRef={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)} placement="bottom-end" width={180} items={menuItems} />
        </div>
      </header>

      <section className="ap-pipeline" aria-labelledby="ap-pipeline-title">
        <h2 id="ap-pipeline-title">{t("求职进度")}</h2>
        <ol className="ap-stepper" aria-label={t("当前阶段：{value0}", { value0: model.currentLabel })}>
          {model.steps.map((step, index) => (
            <li key={step.key} className={`ap-step is-${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
              <div className="ap-step-track">
                <span className="ap-step-mark" aria-hidden="true">{step.state === "done" ? "✓" : step.state === "failed" ? "✕" : step.state === "offer" ? "★" : null}</span>
                {index < model.steps.length - 1 && <span className={`ap-step-line${step.state === "done" ? " is-done" : ""}`} aria-hidden="true" />}
              </div>
              <strong>{step.label}</strong>
              <small>{step.meta || " "}</small>
            </li>
          ))}
        </ol>
      </section>

      <section className={`ap-next is-${accentTone}`} aria-label={t("下一步")}>
        {next.tile.kind === "date" ? (
          <div className="ap-date-tile" aria-hidden="true">
            <small>{next.tile.head}</small>
            <strong>{next.tile.day}</strong>
            <span>{next.tile.foot}</span>
          </div>
        ) : (
          <div className={`ap-status-tile is-${next.tile.tone}`} aria-hidden="true">
            <strong>{next.tile.title}</strong>
            {next.tile.sub && <span>{next.tile.sub}</span>}
          </div>
        )}
        <div className="ap-next-copy">
          <div className="ap-next-chips"><span>{next.lead}</span>{next.chips.map((chip) => <Chip key={chip.label} {...chip} />)}</div>
          <h2>{next.title}</h2>
          {next.detail && <p>{next.detail}</p>}
          {next.hint && <p className="ap-next-hint">{next.hint}</p>}
        </div>
        <div className="ap-next-actions">
          {next.primary && (
            <button type="button" className={next.primary.variant === "dark" ? "ap-primary-button" : "ap-outline-button is-lg"} disabled={busy} onClick={() => onAction(next.primary!.action)}>
              {next.primary.label}
            </button>
          )}
          {next.secondary.length > 0 && (
            <div className="ap-next-secondary">
              {next.secondary.map((button) => (
                <button key={button.action} type="button" className={`ap-text-button${button.danger ? " is-danger" : ""}`} disabled={busy} onClick={() => onAction(button.action)}>
                  {button.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="ap-lower">
        <section className="ap-history" aria-labelledby="ap-history-title">
          <h2 id="ap-history-title">{t("阶段记录")}</h2>
          {history.length === 0 && (
            <div className="ap-history-empty">
              <span className="ap-history-ghost" aria-hidden="true"><i /><i /><i /></span>
              <strong>{t("还没有阶段记录")}</strong>
              <p>{t("记录投递后，筛选、笔试、面试和 Offer 会按时间排在这里")}</p>
            </div>
          )}
          {history.length > 0 && (
            <ol>
              {history.map((item) => (
                <li key={item.id} className="ap-history-item">
                  <div className="ap-history-rail">
                    <i className={`ap-dot is-${item.dot}`} aria-hidden="true" />
                    <time>{item.date}</time>
                  </div>
                  <article className={`ap-stage-card${item.highlight ? ` is-highlight-${item.highlight}` : ""}`}>
                    <header><h3>{item.title}</h3><Chip {...item.chip} /></header>
                    <div>
                      <p>{item.detail}</p>
                      {item.sessionId && (
                        <button type="button" className="ap-link-button" onClick={() => onOpenSession(item.sessionId!)}>
                          {t("查看详情 →")}
                        </button>
                      )}
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          )}
          {hiddenCount > 0 && (
            <button type="button" className="ap-more-history" onClick={() => setShowAllHistory(true)}>
              {t("查看更早 {value0} 个阶段 ↓", { value0: hiddenCount })}
            </button>
          )}
        </section>

        <aside className="ap-side">
          {model.offerCard && (
            <section className="ap-side-card" aria-label={model.offerCard.title}>
              <header><h2>{model.offerCard.title}</h2><button type="button" className="ap-side-action is-link" onClick={onOfferCardAction}>{model.offerCard.action}</button></header>
              <dl>{model.offerCard.rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd className={row.tone ? `is-${row.tone}` : undefined}>{row.value}</dd></div>)}</dl>
            </section>
          )}
          <section className="ap-side-card" aria-label={t("投递信息")}>
            <header>
              <h2>{t("投递信息")}</h2>
              {menu.onEditDelivery && <button type="button" className="ap-side-action is-link" onClick={menu.onEditDelivery}>{t("编辑")}</button>}
            </header>
            <dl>{model.deliveryRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          </section>
          <section className="ap-side-card" aria-labelledby="ap-resources-title">
            <header>
              <h2 id="ap-resources-title">{t("关联资料")}</h2>
              <button type="button" className="ap-side-action is-link" onClick={menu.onManageResources}>{t("管理")}</button>
            </header>
            {resources.length ? (
              <ul className="ap-resources">
                {resources.map((resource) => (
                  <li key={resource.key}>
                    <span className="ap-file-badge" aria-hidden="true">{resource.badge}</span>
                    <div><strong>{resource.name}</strong><small>{resource.meta}</small></div>
                  </li>
                ))}
              </ul>
            ) : <p className="ap-side-empty">{t("还没有关联简历和资料")}</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

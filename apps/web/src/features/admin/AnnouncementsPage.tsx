import { useState } from "react";
import { CalendarClock, CircleAlert, Clock, FileText, Megaphone } from "lucide-react";
import { api, type AdminAnnouncement, type AnnouncementFields, type AnnouncementLevel } from "../../api/client";
import { STATUS_COLORS } from "./charts";
import { DateTimeInput } from "./DateTimeInput";
import {
  Button,
  Chip,
  ConfirmModal,
  ErrorState,
  Field,
  Footnote,
  InlineError,
  LinkButton,
  ListPanel,
  LoadingRegion,
  Modal,
  PageHeader,
  Segmented,
  SkeletonMetrics,
  SkeletonRows,
  StatusDot,
  TableFooter,
  TextTabs,
  errorCode,
  formatWhen,
  fromLocalInput,
  toLocalInput,
  useConsole,
  useLoad,
  type Tone,
} from "./kit";

const TITLE_MAX = 120;
const BODY_MAX = 5000;

const visibilityBadge: Record<AdminAnnouncement["visibility"], { tone: Tone; label: string }> = {
  draft: { tone: "warn", label: "草稿" },
  scheduled: { tone: "info", label: "定时" },
  active: { tone: "ok", label: "生效中" },
  expired: { tone: "muted", label: "已过期" },
  unpublished: { tone: "muted", label: "已下线" },
};

function windowText(item: AdminAnnouncement) {
  if (!item.startsAt && !item.endsAt) return item.status === "draft" ? "未设置" : `${formatWhen(item.publishedAt)} – 长期`;
  const start = item.startsAt ? formatWhen(item.startsAt) : item.status === "draft" ? "发布后" : formatWhen(item.publishedAt);
  return `${start} – ${item.endsAt ? formatWhen(item.endsAt) : "长期"}`;
}

const announcementErrors: Record<string, string> = {
  ANNOUNCEMENT_STATE_CONFLICT: "公告状态已变化，请刷新后重试",
  ANNOUNCEMENT_WINDOW_INVALID: "结束时间必须晚于开始时间",
  ANNOUNCEMENT_NOT_FOUND: "公告不存在，可能已被删除",
};

type Filter = "" | AdminAnnouncement["status"];
type Pending = { kind: "publish" | "unpublish" | "delete"; item: AdminAnnouncement } | null;

export function AnnouncementsPage() {
  const { notify } = useConsole();
  const stats = useLoad(() => api.adminAnnouncementStats());
  const [filter, setFilter] = useState<Filter>("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const list = useLoad(() => api.adminListAnnouncements({ status: filter || undefined, cursor, limit: 20 }), [filter, cursor]);
  const [editing, setEditing] = useState<AdminAnnouncement | "new" | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => { void list.reload(); void stats.reload(); };

  const act = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "publish") await api.adminPublishAnnouncement(pending.item.id);
      if (pending.kind === "unpublish") await api.adminUnpublishAnnouncement(pending.item.id);
      if (pending.kind === "delete") await api.adminDeleteAnnouncement(pending.item.id);
      notify({ publish: "公告已发布", unpublish: "公告已下线", delete: "草稿已删除" }[pending.kind]);
      setPending(null);
      refresh();
    } catch (error) {
      const code = errorCode(error);
      notify(announcementErrors[code] ?? `操作失败：${code}`, "error");
      setPending(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const changeFilter = (next: Filter) => { setFilter(next); setCursor(undefined); setHistory([]); };
  const counts = stats.data;
  // "已发布" splits into live, scheduled and expired, so the ribbon segments add up to the total.
  const ribbon = counts ? [
    { key: "active", label: "生效中", value: counts.active, color: STATUS_COLORS.ok },
    { key: "scheduled", label: "定时", value: counts.scheduled, color: STATUS_COLORS.info },
    { key: "expired", label: "已过期", value: Math.max(0, counts.published - counts.active - counts.scheduled), color: "#b9bab5" },
    { key: "draft", label: "草稿", value: counts.draft, color: STATUS_COLORS.warn },
    { key: "unpublished", label: "已下线", value: counts.unpublished, color: "#d8d8d4" },
  ] : [];
  const total = ribbon.reduce((sum, item) => sum + item.value, 0);
  const items = list.data?.items ?? [];

  return (
    <>
      <PageHeader title="应用内公告" actions={<Button variant="primary" onClick={() => setEditing("new")}>新建公告</Button>} />
      {stats.loading && !counts ? <SkeletonMetrics /> : counts ? (
        <section className="adm-ribbon" aria-label="公告状态">
          <div className="adm-ribbon-counts">
            {ribbon.map((item) => (
              <span key={item.key} className={item.key === "active" ? "is-lead" : undefined}><i style={{ background: item.color }} aria-hidden="true" />{item.label}<b>{item.value}</b></span>
            ))}
            <small>共 {total} 条</small>
          </div>
          <div className="adm-ribbon-bar" aria-hidden="true">
            {ribbon.filter((item) => item.value > 0).map((item) => <i key={item.key} style={{ flexGrow: item.value, background: item.color }} />)}
          </div>
        </section>
      ) : <ErrorState code={stats.error} onRetry={() => void stats.reload()} />}
      <ListPanel label="公告列表" resetKey={`${filter}|${cursor ?? ""}`}
        toolbar={(
        <TextTabs label="公告状态" value={filter} onChange={changeFilter} options={[
          { value: "", label: "全部", count: counts ? total : null },
          { value: "draft", label: "草稿", count: counts?.draft },
          { value: "published", label: "已发布", count: counts?.published },
          { value: "unpublished", label: "已下线", count: counts?.unpublished },
        ]} />
        )}
        footer={
          (history.length > 0 || list.data?.nextCursor) && (
              <TableFooter>
                <span />
                <div>
                  <Button disabled={!history.length} onClick={() => { setCursor(history[history.length - 1]); setHistory((value) => value.slice(0, -1)); }}>上一页</Button>
                  <Button disabled={!list.data?.nextCursor} onClick={() => { setHistory((value) => [...value, cursor]); setCursor(list.data?.nextCursor ?? undefined); }}>下一页</Button>
                </div>
              </TableFooter>
            )
        }
      >
        {list.loading && !list.data ? <LoadingRegion label="正在加载公告…"><SkeletonRows rows={5} columns={3} height={96} /></LoadingRegion> : list.error ? (
          <ErrorState code={list.error} onRetry={() => void list.reload()} />
        ) : items.length === 0 ? (
          <div className="adm-state"><strong>{filter ? "当前筛选下没有公告" : "还没有公告，点击右上角新建"}</strong></div>
        ) : (
          <>
            <ul className={`adm-feed adm-announcements${list.loading ? " is-busy" : ""}`} key={`${filter}|${cursor ?? ""}`} aria-label="公告列表">
              {items.map((row, index) => {
                const Icon = row.status === "draft" ? FileText : row.visibility === "scheduled" ? CalendarClock : Megaphone;
                const tint = row.status === "draft" ? "gray" : row.visibility === "scheduled" ? "blue" : row.level === "important" ? "amber" : "violet";
                const state = visibilityBadge[row.visibility];
                return (
                  <li
                    key={row.id}
                    style={{ "--adm-i": Math.min(index, 12) } as React.CSSProperties}
                    className={row.status === "draft" ? "is-clickable" : undefined}
                    tabIndex={row.status === "draft" ? 0 : undefined}
                    aria-label={row.status === "draft" ? `编辑公告 ${row.title}` : undefined}
                    onClick={row.status === "draft" ? () => setEditing(row) : undefined}
                    onKeyDown={row.status === "draft" ? (event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); setEditing(row); } } : undefined}
                  >
                    <Chip icon={Icon} tint={tint} size={38} />
                    <div className="adm-feed-copy">
                      <strong>{row.title}{row.level === "important" && <span className="adm-feed-tag">重要</span>}</strong>
                      <span>{row.body.replace(/\s+/g, " ")}</span>
                      <span className="adm-feed-meta"><Clock size={13} aria-hidden="true" />{windowText(row)}</span>
                    </div>
                    <div className="adm-feed-end">
                      <StatusDot tone={state.tone}>{state.label}</StatusDot>
                      <span className="adm-row-actions">
                        {row.status === "draft" && <>
                          <LinkButton onClick={() => setEditing(row)}>编辑</LinkButton>
                          <LinkButton onClick={() => setPending({ kind: "publish", item: row })}>发布</LinkButton>
                          <LinkButton tone="bad" onClick={() => setPending({ kind: "delete", item: row })}>删除</LinkButton>
                        </>}
                        {row.status === "published" && <LinkButton tone="bad" onClick={() => setPending({ kind: "unpublish", item: row })}>下线</LinkButton>}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </ListPanel>
      <Footnote icon={CircleAlert}>草稿可编辑、发布、删除；已发布只能下线，下线后不可恢复。用户端只展示生效中的公告。</Footnote>

      {editing && <AnnouncementEditor item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {pending && (
        <ConfirmModal
          title={{ publish: "发布公告？", unpublish: "下线公告？", delete: "删除草稿？" }[pending.kind]}
          confirmLabel={{ publish: "确认发布", unpublish: "确认下线", delete: "删除" }[pending.kind]}
          danger={pending.kind !== "publish"}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void act()}
        >
          {pending.kind === "publish" && <p>「{pending.item.title}」发布后只能下线，不能再编辑。{pending.item.startsAt ? `将在 ${formatWhen(pending.item.startsAt)} 开始展示。` : "发布后立即对用户展示。"}</p>}
          {pending.kind === "unpublish" && <p>「{pending.item.title}」将立即从用户端移除。下线后不能重新发布，如需再次展示请新建公告。</p>}
          {pending.kind === "delete" && <p>草稿「{pending.item.title}」将被永久删除。</p>}
        </ConfirmModal>
      )}
    </>
  );
}

function AnnouncementEditor({ item, onClose, onSaved }: { item: AdminAnnouncement | null; onClose: () => void; onSaved: () => void }) {
  const { notify } = useConsole();
  const [level, setLevel] = useState<AnnouncementLevel>(item?.level ?? "normal");
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [startsAt, setStartsAt] = useState(toLocalInput(item?.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(item?.endsAt));
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = fromLocalInput(startsAt);
  const end = fromLocalInput(endsAt);
  const windowInvalid = Boolean(start && end && new Date(end) <= new Date(start));
  const valid = title.trim().length > 0 && title.length <= TITLE_MAX && body.trim().length > 0 && body.length <= BODY_MAX && !windowInvalid;

  const save = async (publish: boolean) => {
    if (!valid) return;
    setBusy(publish ? "publish" : "draft");
    setError(null);
    const fields: AnnouncementFields = { level, title: title.trim(), body, startsAt: start, endsAt: end };
    try {
      const saved = item ? (await api.adminUpdateAnnouncement(item.id, fields)).announcement : (await api.adminCreateAnnouncement(fields)).announcement;
      if (publish) await api.adminPublishAnnouncement(saved.id);
      notify(publish ? "公告已发布" : "草稿已保存");
      onSaved();
    } catch (caught) {
      const code = errorCode(caught);
      setError(announcementErrors[code] ?? `保存失败：${code}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      width={620}
      title={item ? "编辑公告" : "新建公告"}
      subtitle="保存为草稿后可继续编辑；发布后只能下线"
      onClose={onClose}
      busy={busy !== null}
      footer={(
        <>
          <Button dismiss disabled={busy !== null}>取消</Button>
          <Button onClick={() => void save(false)} disabled={!valid || busy !== null}>{busy === "draft" ? "保存中…" : "保存草稿"}</Button>
          <Button variant="primary" onClick={() => void save(true)} disabled={!valid || busy !== null}>{busy === "publish" ? "发布中…" : "保存并发布"}</Button>
        </>
      )}
    >
      <div className="adm-form">
        <Field label="级别">
          <Segmented label="公告级别" value={level} onChange={setLevel} options={[{ value: "normal", label: "普通" }, { value: "important", label: "重要" }]} />
        </Field>
        <Field label="标题" htmlFor="announcement-title" hint={`${title.length} / ${TITLE_MAX}`}>
          <input id="announcement-title" className="adm-input" value={title} maxLength={TITLE_MAX} onChange={(event) => setTitle(event.target.value)} placeholder="例如：LinkResume 新版本上线" />
        </Field>
        <Field label="正文" htmlFor="announcement-body" hint={`${body.length} / ${BODY_MAX} · 纯文本，支持换行`}>
          <textarea id="announcement-body" className="adm-input adm-textarea" value={body} maxLength={BODY_MAX} rows={6} onChange={(event) => setBody(event.target.value)} />
        </Field>
        <div className="adm-form-row">
          <Field label="开始时间" htmlFor="announcement-start" hint="留空：发布后立即生效">
            <DateTimeInput id="announcement-start" label="开始时间" value={startsAt} onChange={setStartsAt} placeholder="发布后立即生效" />
          </Field>
          <Field label="结束时间" htmlFor="announcement-end" hint="留空：不设结束时间" error={windowInvalid ? "结束时间必须晚于开始时间" : undefined}>
            <DateTimeInput id="announcement-end" label="结束时间" value={endsAt} onChange={setEndsAt} placeholder="不设结束时间" defaultTime="23:59" />
          </Field>
        </div>
        {error && <InlineError>{error}</InlineError>}
      </div>
    </Modal>
  );
}

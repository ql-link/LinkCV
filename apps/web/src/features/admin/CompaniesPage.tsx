import { useMemo, useRef, useState, type ChangeEvent } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronRight, Image as ImageIcon, Info, Link2, Upload } from "lucide-react";
import { api, ApiRequestError, type LogoFingerprint, type SharedCompany, type UnmatchedCompanyName } from "../../api/client";
import { PoolCompanyLogo } from "../jobs/PoolUi";
import { poolError } from "../jobs/jobPoolPresentation";
import {
  Button, DataTable, ErrorState, Footnote, InlineError, LinkButton, ListPanel, LoadingRegion, Modal, PageHeader, SearchInput,
  SkeletonRows, useLoad,
} from "./kit";
import { shortWhen } from "./JobPoolPanel";
import "./job-pool.css";

type Tab = "all" | "none" | "plugin" | "admin" | "unmatched" | "placeholder";
type LogoChange = { kind: "file"; file: File; preview: string } | { kind: "url"; url: string } | { kind: "clear" } | null;

const LOGO_HINT = "PNG / JPG / WebP，2 MB 以内，系统统一转存；手动设置后自动采集不再覆盖。";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();

function sourceLabel(company: SharedCompany) {
  if (!company.logo_url) return company.logo_source === "admin" ? "管理员已清除" : "暂无图标";
  return ({ official: "企业官网", plugin: "插件采集", admin: "管理员设置", unknown: "已有图标" } as const)[company.logo_source];
}

export function CompaniesPage() {
  const companies = useLoad(() => api.listSharedCompanies());
  const unmatched = useLoad(() => api.listUnmatchedCompanyNames());
  const suspected = useLoad(() => api.listLogoFingerprints("suspected"));
  const blocked = useLoad(() => api.listLogoFingerprints("placeholder"));
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<SharedCompany | null>(null);
  const [notice, setNotice] = useState("");
  const items = companies.data?.items ?? [];
  const text = normalized(search);
  const counts = {
    all: items.length,
    none: items.filter((company) => !company.logo_url).length,
    plugin: items.filter((company) => company.logo_url && company.logo_source === "plugin").length,
    admin: items.filter((company) => company.logo_source === "admin").length,
  };
  const visible = items.filter((company) => (tab === "all" || (tab === "none" ? !company.logo_url : tab === "plugin" ? company.logo_url && company.logo_source === "plugin" : company.logo_source === "admin"))
    && (!text || [company.name, ...company.aliases].some((name) => normalized(name).includes(text))));
  const replace = (company: SharedCompany) => companies.setData((previous) => previous && { items: previous.items.map((item) => item.id === company.id ? company : item) });
  const onConflict = () => { setEditing(null); setNotice("公司资料已被更新，请重新编辑。"); void companies.reload(); };
  const isCompanyTab = tab !== "unmatched" && tab !== "placeholder";

  return <>
    <PageHeader title="公司图标" meta="统一官网岗位、插件导入与求职记录中的企业识别。插件采集的图标自动补充到对应公司；无图或加载失败时显示公司名称首字。" />
    {notice && <InlineError>{notice}</InlineError>}
    <ListPanel label="公司图标" resetKey={`${tab}|${text}`}
      toolbar={<div className="adm-filterbar pool-admin-filterbar">
        <div className="adm-text-tabs pool-company-tabs" role="tablist" aria-label="公司图标筛选">
          {([["all", "全部", counts.all], ["none", "暂无图标", counts.none], ["plugin", "插件采集", counts.plugin], ["admin", "管理员设置", counts.admin]] as const).map(([value, label, count]) =>
            <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}{companies.data && <>{" "}<b>{count}</b></>}</button>)}
          <i className="pool-tab-divider" aria-hidden="true" />
          <button type="button" role="tab" aria-selected={tab === "unmatched"} onClick={() => setTab("unmatched")}>待匹配名称{unmatched.data && <>{" "}<b className={unmatched.data.items.length ? "is-warn" : undefined}>{unmatched.data.items.length}</b></>}</button>
          <button type="button" role="tab" aria-selected={tab === "placeholder"} onClick={() => setTab("placeholder")}>疑似默认图{suspected.data && <>{" "}<b className={suspected.data.items.length ? "is-warn" : undefined}>{suspected.data.items.length}</b></>}</button>
        </div>
        {tab !== "placeholder" && <SearchInput value={search} onChange={setSearch} placeholder={tab === "unmatched" ? "搜索未匹配的名称" : "搜索公司名称 / 别名"} width={240} />}
      </div>}
      footer={tab === "unmatched" ? <Footnote icon={Info}>只统计公司名称和出现次数，不记录用户和岗位内容。归入后这个名称会加为所选公司的别名，以后同名岗位自动匹配并共享图标。</Footnote>
        : tab === "placeholder" ? <Footnote icon={Info}>标记后，使用这张图的插件来源图标会被清除并显示公司首字，之后插件上传的同款图片既不共享也不保存；官网和管理员设置的图标不受影响。</Footnote> : null}>
      {isCompanyTab ? (companies.loading && !companies.data ? <LoadingRegion label="正在加载公司…"><SkeletonRows rows={8} columns={4} /></LoadingRegion>
        : companies.error ? <ErrorState title="公司资料暂时无法加载" code={companies.error} onRetry={() => void companies.reload()} />
          : <DataTable<SharedCompany> className="pool-company-table" rows={visible} rowKey={(row) => row.id} busy={companies.loading}
            empty={items.length ? "没有符合条件的公司，换个名称或筛选试试。" : "预置公司会在服务启动时自动登记。"}
            onRowClick={(row) => { setNotice(""); setEditing(row); }} rowLabel={(row) => `编辑${row.name}`}
            columns={[
              { key: "name", label: "公司", width: "minmax(200px, 1.5fr)", render: (row) => <span className="pool-source-company"><PoolCompanyLogo company={row} size={32} /><strong>{row.name}</strong></span> },
              { key: "aliases", label: "匹配名称", width: "minmax(220px, 2.2fr)", render: (row) => <span className="pool-ellipsis">{[row.name, ...row.aliases.filter((alias) => normalized(alias) !== normalized(row.name))].join(" / ")}</span> },
              { key: "source", label: "图标来源", width: "minmax(120px, 1fr)", render: (row) => <span className={row.logo_url ? undefined : "pool-faint"}>{sourceLabel(row)}</span> },
              { key: "open", label: "", width: "32px", align: "right", render: () => <ChevronRight size={15} className="pool-faint" aria-hidden="true" /> },
            ]} />)
        : tab === "unmatched" ? <UnmatchedNames state={unmatched} companies={items} search={text} onAssigned={(company) => { replace(company); void unmatched.reload(); }} onConflict={onConflict} />
          : <Placeholders suspected={suspected} blocked={blocked} onReviewed={() => { void suspected.reload(); void blocked.reload(); void companies.reload(); }} />}
    </ListPanel>
    {editing && <CompanyEditor key={editing.id} company={editing} onClose={() => setEditing(null)} onConflict={onConflict}
      onSaved={(company) => { replace(company); setEditing(null); }} />}
  </>;
}

function UnmatchedNames({ state, companies, search, onAssigned, onConflict }: {
  state: ReturnType<typeof useLoad<{ items: UnmatchedCompanyName[] }>>; companies: SharedCompany[]; search: string;
  onAssigned: (company: SharedCompany) => void; onConflict: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const rows = (state.data?.items ?? []).filter((item) => !search || normalized(item.name).includes(search));
  const act = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id); setError("");
    try { await action(); }
    catch (reason) {
      if (reason instanceof ApiRequestError && reason.message === "COMPANY_CONFLICT") onConflict();
      else setError(poolError(reason));
    } finally { setBusy(null); }
  };
  if (state.loading && !state.data) return <LoadingRegion label="正在加载待匹配名称…"><SkeletonRows rows={6} columns={4} /></LoadingRegion>;
  if (state.error) return <ErrorState title="待匹配名称暂时无法加载" code={state.error} onRetry={() => void state.reload()} />;
  return <>
    {error && <InlineError>{error}</InlineError>}
    <DataTable<UnmatchedCompanyName> className="pool-unmatched-table" rows={rows} rowKey={(row) => row.id} busy={state.loading}
      empty="暂时没有待匹配的名称。插件导入的公司名都能对应到已有公司。"
      columns={[
        { key: "name", label: "未匹配的公司名称", width: "minmax(220px, 2fr)", render: (row) => <strong className="pool-ellipsis">{row.name}</strong> },
        { key: "count", label: "出现次数", width: "88px", align: "right", render: (row) => row.hit_count },
        { key: "seen", label: "最近出现", width: "minmax(110px, 1fr)", render: (row) => shortWhen(row.last_seen_at, "—") },
        { key: "actions", label: "操作", width: "180px", render: (row) => <span className="pool-row-actions">
          <AssignCompany name={row.name} companies={companies} disabled={busy !== null}
            onPick={(company) => void act(row.id, async () => onAssigned(await api.assignUnmatchedCompanyName(row.id, company)))} />
          <LinkButton tone="muted" disabled={busy !== null} onClick={() => void act(row.id, async () => { await api.ignoreUnmatchedCompanyName(row.id); await state.reload(); })}>忽略</LinkButton>
        </span> },
      ]} />
  </>;
}

/** 「归入公司」：搜索已有公司并选中；名字相近的排在前面。 */
function AssignCompany({ name, companies, disabled, onPick }: { name: string; companies: SharedCompany[]; disabled: boolean; onPick: (company: SharedCompany) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const key = normalized(name);
  const similar = (company: SharedCompany) => [company.name, ...company.aliases].some((value) => {
    const other = normalized(value);
    return other.length >= 2 && (key.includes(other) || other.includes(key));
  });
  const text = normalized(query);
  const options = useMemo(() => companies
    .filter((company) => !text || [company.name, ...company.aliases].some((value) => normalized(value).includes(text)))
    .sort((a, b) => Number(similar(b)) - Number(similar(a)))
    .slice(0, 8), [companies, text]); // eslint-disable-line react-hooks/exhaustive-deps
  return <PopoverPrimitive.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) setQuery(""); }}>
    <PopoverPrimitive.Trigger className="adm-btn adm-btn-secondary pool-small-btn" disabled={disabled} aria-label={`将${name}归入公司`}>归入公司</PopoverPrimitive.Trigger>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content className="adm-select-content pool-assign" align="end" sideOffset={6} collisionPadding={12}>
        <SearchInput value={query} onChange={setQuery} placeholder="搜索公司名称 / 别名" />
        <p className="pool-assign-label">选择公司</p>
        <div className="pool-assign-list" role="listbox" aria-label="选择公司">
          {options.length ? options.map((company) => <button key={company.id} type="button" role="option" aria-selected={false} onClick={() => { setOpen(false); onPick(company); }}>
            <PoolCompanyLogo company={company} size={20} /><span>{company.name}</span>{similar(company) && <small>名称相近</small>}
          </button>) : <p className="pool-faint">没有匹配的公司</p>}
        </div>
        <p className="pool-assign-foot">「{name}」将加为所选公司的别名</p>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}

function Placeholders({ suspected, blocked, onReviewed }: {
  suspected: ReturnType<typeof useLoad<{ items: LogoFingerprint[] }>>; blocked: ReturnType<typeof useLoad<{ items: LogoFingerprint[] }>>; onReviewed: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const review = async (row: LogoFingerprint, decision: "mark-placeholder" | "allow") => {
    setBusy(row.id); setError("");
    try { await api.reviewLogoFingerprint(row.id, decision); onReviewed(); }
    catch (reason) { setError(poolError(reason)); }
    finally { setBusy(null); }
  };
  const image = (row: LogoFingerprint) => <span className="pool-fingerprint"><img src={row.image_url} alt={`疑似默认图 ${row.id}`} loading="lazy" /></span>;
  const usage = (row: LogoFingerprint, title: string) => <span className="pool-two-line"><strong>{title}</strong>
    <small>{row.sample_names.length ? `${row.sample_names.slice(0, 3).join("、")}${row.company_count > 3 ? " 等" : ""}` : "—"}</small></span>;
  if (suspected.loading && !suspected.data) return <LoadingRegion label="正在加载疑似默认图…"><SkeletonRows rows={3} columns={4} /></LoadingRegion>;
  if (suspected.error) return <ErrorState title="疑似默认图暂时无法加载" code={suspected.error} onRetry={() => void suspected.reload()} />;
  const blockedRows = blocked.data?.items ?? [];
  return <>
    {error && <InlineError>{error}</InlineError>}
    <DataTable<LogoFingerprint> className="pool-fingerprint-table" rows={suspected.data?.items ?? []} rowKey={(row) => row.id} busy={suspected.loading}
      empty="暂时没有疑似默认图。同一张图被 3 家以上公司使用时会出现在这里。"
      columns={[
        { key: "image", label: "图片", width: "72px", render: image },
        { key: "usage", label: "使用情况", width: "minmax(220px, 2fr)", render: (row) => usage(row, `${row.company_count >= 20 ? "20+" : row.company_count} 家公司使用`) },
        { key: "reason", label: "判定依据", width: "minmax(180px, 1.4fr)", render: () => <span className="pool-reason"><i aria-hidden="true" />自动发现 · 3 家以上公司共用同一张图</span> },
        { key: "actions", label: "操作", width: "200px", render: (row) => <span className="pool-row-actions">
          <Button className="pool-small-btn" disabled={busy !== null} onClick={() => void review(row, "mark-placeholder")}>标记为默认图</Button>
          <LinkButton tone="muted" disabled={busy !== null} onClick={() => void review(row, "allow")}>不是默认图</LinkButton>
        </span> },
      ]} />
    {blockedRows.length > 0 && <>
      <p className="pool-section-label">已屏蔽 · {blockedRows.length}</p>
      <DataTable<LogoFingerprint> className="pool-fingerprint-table is-blocked" headless rows={blockedRows} rowKey={(row) => row.id}
        columns={[
          { key: "image", label: "图片", width: "72px", render: image },
          { key: "usage", label: "使用情况", width: "minmax(220px, 2fr)", render: (row) => usage(row, "已标记为默认图") },
          { key: "reason", label: "判定依据", width: "minmax(180px, 1.4fr)", render: () => <span className="pool-faint">管理员标记</span> },
          { key: "actions", label: "操作", width: "200px", render: (row) => <LinkButton tone="muted" disabled={busy !== null} onClick={() => void review(row, "allow")}>撤销</LinkButton> },
        ]} />
    </>}
  </>;
}

function CompanyEditor({ company, onClose, onSaved, onConflict }: {
  company: SharedCompany; onClose: () => void; onSaved: (company: SharedCompany) => void; onConflict: () => void;
}) {
  const [aliases, setAliases] = useState(company.aliases.filter((alias) => normalized(alias) !== normalized(company.name)));
  const [alias, setAlias] = useState("");
  const [change, setChange] = useState<LogoChange>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const addAlias = () => {
    const value = alias.trim();
    if (!value) return;
    if (aliases.length >= 30 || value.length > 200) { setError("最多添加 30 个别名，每个不超过 200 个字符。"); return; }
    if (![company.name, ...aliases].some((item) => normalized(item) === normalized(value))) setAliases((previous) => [...previous, value]);
    setAlias(""); setError("");
  };
  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) { setError("图片超过 2MB，请压缩后再试。"); return; }
    setChange({ kind: "file", file, preview: URL.createObjectURL(file) }); setUrlOpen(false); setPreviewFailed(false); setError("");
  };
  const readUrl = () => {
    try { const parsed = new URL(url.trim()); if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(); }
    catch { setError("请输入不含账号密码的 HTTPS 图片地址。"); return; }
    setChange({ kind: "url", url: url.trim() }); setPreviewFailed(false); setError("");
  };
  const preview = change?.kind === "file" ? change.preview : change?.kind === "url" ? change.url : change?.kind === "clear" ? null : company.logo_url;
  const status = change?.kind === "clear" ? "图标将被清除 · 保存后显示公司名称首字"
    : change ? (previewFailed ? "无法预览这张图片 · 保存时由服务器读取" : "新图标已读取 · 保存后生效")
      : company.logo_url ? `当前来自${sourceLabel(company)}` : "未设置图标 · 显示公司名称首字";

  const save = async () => {
    if (pending.current) return;
    const typed = alias.trim();
    const nextAliases = typed && ![company.name, ...aliases].some((item) => normalized(item) === normalized(typed)) ? [...aliases, typed] : aliases;
    if (nextAliases.length > 30 || nextAliases.some((item) => item.length > 200)) { setError("最多添加 30 个别名，每个不超过 200 个字符。"); return; }
    const aliasesChanged = nextAliases.join("\n") !== company.aliases.join("\n");
    if (!change && !aliasesChanged) { onClose(); return; }
    pending.current = true; setBusy(true); setError("");
    try {
      let saved = company;
      if (change?.kind === "file") saved = await api.uploadSharedCompanyLogo(saved, change.file);
      const update: { aliases?: string[]; logo_url?: string | null } = {};
      if (aliasesChanged) update.aliases = nextAliases;
      if (change?.kind === "url") update.logo_url = change.url;
      if (change?.kind === "clear") update.logo_url = null;
      if (Object.keys(update).length) saved = await api.updateSharedCompany(saved, update);
      onSaved(saved);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status === 409) onConflict(); else setError(poolError(reason));
    } finally { pending.current = false; setBusy(false); }
  };

  return <Modal width={480} busy={busy} onClose={onClose} title={`编辑公司 · ${company.name}`} footer={<>
    <Button dismiss disabled={busy}>取消</Button>
    <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "正在保存…" : "保存"}</Button>
  </>}>
    <div className="pool-editor">
      <section>
        <p className="pool-editor-label">图标</p>
        <div className="pool-editor-logo">
          <span className="pool-editor-preview">
            {preview && !previewFailed ? <img src={preview} alt={`${company.name} 图标预览`} onError={() => setPreviewFailed(true)} />
              : <span aria-hidden="true">{[...company.name.trim()][0] ?? "企"}</span>}
          </span>
          <div>
            <p className="pool-editor-status">{status}</p>
            <div className="pool-editor-actions">
              <Button className="pool-small-btn" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={13} aria-hidden="true" />上传图片</Button>
              <Button className={`pool-small-btn${urlOpen ? " is-pressed" : ""}`} aria-pressed={urlOpen} disabled={busy} onClick={() => setUrlOpen((value) => !value)}><Link2 size={13} aria-hidden="true" />填写图片地址</Button>
              {(company.logo_url || (change && change.kind !== "clear")) && <LinkButton tone="muted" disabled={busy} onClick={() => { setChange(company.logo_url ? { kind: "clear" } : null); setUrlOpen(false); }}>清除图标</LinkButton>}
            </div>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden aria-label="上传公司图标" onChange={pickFile} />
          </div>
        </div>
        {urlOpen && <div className="pool-editor-url">
          <input className="adm-input" aria-label="图片地址" placeholder="https://" maxLength={2048} value={url} disabled={busy}
            onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); readUrl(); } }} />
          <Button disabled={busy || !url.trim()} onClick={readUrl}><ImageIcon size={13} aria-hidden="true" />读取</Button>
        </div>}
        <p className="pool-editor-hint">{LOGO_HINT}</p>
      </section>
      <section>
        <label className="pool-editor-label" htmlFor="company-alias">名称别名</label>
        <div className="pool-alias-box" onClick={() => document.getElementById("company-alias")?.focus()}>
          <span className="pool-alias is-fixed">{company.name}</span>
          {aliases.map((name) => <span key={name} className="pool-alias">{name}
            <button type="button" aria-label={`移除别名${name}`} disabled={busy} onClick={(event) => { event.stopPropagation(); setAliases((previous) => previous.filter((item) => item !== name)); }}>×</button></span>)}
          <input id="company-alias" aria-label="添加公司别名" placeholder="输入别名，回车添加" maxLength={200} value={alias} disabled={busy}
            onChange={(event) => setAlias(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addAlias(); } }} />
        </div>
        <p className="pool-editor-hint">插件采集到这些名称的岗位时，会共享这家公司的图标。</p>
      </section>
      {error && <InlineError>{error}</InlineError>}
    </div>
  </Modal>;
}

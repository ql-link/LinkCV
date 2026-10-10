import { useEffect, useRef, useState } from "react";
import { api, type SharedCompany } from "../../api/client";
import { Button, FeedbackNotice, Input, PageHeader } from "@/components/ui";
import { PoolCompanyLogo, PoolDialog, PoolSearch, PoolSelect, PoolState } from "../jobs/PoolUi";
import { poolError } from "../jobs/jobPoolPresentation";
import "./job-pool.css";

const sources = { unknown: "已有图标", official: "企业官网", plugin: "插件采集", admin: "管理员设置" };

export function CompaniesPage() {
  const [companies, setCompanies] = useState<SharedCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [editor, setEditor] = useState<{ company: SharedCompany; mode: "aliases" | "logo" } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    api.listSharedCompanies().then((result) => { if (!cancelled) setCompanies(result.items); })
      .catch((reason) => { if (!cancelled) setError(poolError(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision]);
  const visible = companies.filter((company) => [company.name, ...company.aliases].some((name) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    && (status === "all" || (status === "missing" ? !company.logo_url : status === "present" ? Boolean(company.logo_url) : company.logo_source === status)));
  return <section className="pool-theme pool-admin pool-companies">
    <PageHeader eyebrow={null} title="公司图标" description="统一官网岗位、插件导入与求职记录中的企业识别。" actions={<Button variant="outline" disabled={loading} onClick={() => setRevision((value) => value + 1)}>刷新</Button>} />
    <div className="pool-admin-filters"><PoolSearch aria-label="搜索公司名称或别名" placeholder="搜索公司名称 / 别名" value={search} onChange={(event) => setSearch(event.target.value)} />
      <PoolSelect label="图标状态" value={status} onChange={(event) => setStatus(event.target.value)} options={[
        { value: "all", label: "全部图标状态" }, { value: "present", label: "已有图标" }, { value: "missing", label: "暂无图标" },
        { value: "official", label: "企业官网" }, { value: "plugin", label: "插件采集" }, { value: "admin", label: "管理员设置" },
      ]} /></div>
    {notice && <FeedbackNotice kind="warning">{notice}</FeedbackNotice>}
    {error && <PoolState title="加载失败" description={error} error><Button variant="outline" onClick={() => setRevision((value) => value + 1)}>重新加载</Button></PoolState>}
    {loading ? <div className="pool-admin-loading" role="status">正在加载公司资料…</div> : !error && (visible.length ? <div className="pool-table-scroll"><table className="pool-company-table">
      <thead><tr><th>公司与图标</th><th>匹配名称</th><th>当前图标来源</th><th>操作</th></tr></thead>
      <tbody>{visible.map((company) => <tr key={company.id}><td><div className="pool-company-identity"><PoolCompanyLogo company={company} size={32} /><strong>{company.name}</strong></div></td>
        <td>{[company.name, ...company.aliases].filter((name, index, names) => names.indexOf(name) === index).join(" / ")}</td>
        <td>{company.logo_url ? sources[company.logo_source] : "暂无图标"}</td>
        <td><div className="pool-company-actions"><button type="button" aria-label={`管理${company.name}匹配`} onClick={() => setEditor({ company, mode: "aliases" })}>管理匹配</button><span>·</span><button type="button" aria-label={`更换${company.name}图标`} onClick={() => setEditor({ company, mode: "logo" })}>更换图标</button></div></td></tr>)}</tbody>
    </table></div> : <PoolState title="没有符合条件的公司" description={companies.length ? "换个名称或图标状态试试。" : "在官网岗位池中注册来源后，公司会显示在这里。"} />)}
    <aside className="pool-company-explainer"><h2>匹配到公司后，自动共享图标</h2><p>插件采集的图标自动补充至对应公司；管理员可纠正公司别名与默认图标。</p><p>无图或加载失败时，显示公司名称首字。</p></aside>
    {editor && <CompanyEditor key={`${editor.company.id}-${editor.mode}`} {...editor} onClose={() => setEditor(null)} onSaved={(company) => {
      setCompanies((previous) => previous.map((item) => item.id === company.id ? company : item)); setNotice(""); setEditor(null);
    }} onConflict={() => { setEditor(null); setNotice("公司资料已被更新，请重新编辑。"); setRevision((value) => value + 1); }} />}
  </section>;
}

function CompanyEditor({ company, mode, onClose, onSaved, onConflict }: {
  company: SharedCompany; mode: "aliases" | "logo"; onClose: () => void; onSaved: (company: SharedCompany) => void; onConflict: () => void;
}) {
  const [aliases, setAliases] = useState(company.aliases);
  const [alias, setAlias] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const addAlias = () => {
    const value = alias.trim();
    if (!value) return;
    if (aliases.length >= 30 || value.length > 200) { setError("最多添加 30 个别名，每个不超过 200 个字符。"); return; }
    if (!aliases.some((item) => item.normalize("NFKC").toLocaleLowerCase() === value.normalize("NFKC").toLocaleLowerCase())) setAliases((previous) => [...previous, value]);
    setAlias(""); setError("");
  };
  const save = async () => {
    if (pending.current) return;
    let changes: { aliases?: string[]; logo_url?: string };
    if (mode === "aliases") {
      const value = alias.trim();
      const next = value && !aliases.includes(value) ? [...aliases, value] : aliases;
      if (next.length > 30 || next.some((item) => item.length > 200)) { setError("最多添加 30 个别名，每个不超过 200 个字符。"); return; }
      changes = { aliases: next };
    } else {
      try { const parsed = new URL(url.trim()); if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(); }
      catch { setError("请输入不含账号密码的 HTTPS 图片地址。"); return; }
      changes = { logo_url: url.trim() };
    }
    pending.current = true; setBusy(true); setError("");
    try { onSaved(await api.updateSharedCompany(company, changes)); }
    catch (reason) { if (reason && typeof reason === "object" && "status" in reason && reason.status === 409) onConflict(); else setError(poolError(reason)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <PoolDialog title={mode === "aliases" ? "管理公司匹配" : "更换默认 Logo"} wide busy={busy} onClose={onClose} footer={<>
    <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy} onClick={() => void save()}>{busy ? "正在保存…" : mode === "aliases" ? "保存匹配" : "保存图标"}</Button>
  </>}>
    <div className={`pool-company-editor-identity${mode === "logo" ? " pool-company-preview" : ""}`}><PoolCompanyLogo company={company} size={mode === "logo" ? 64 : 40} /><div><strong>{company.name}</strong>{mode === "logo" && <p>当前来源 · {company.logo_url ? sources[company.logo_source] : "暂无图标"}</p>}</div></div>
    {mode === "aliases" ? <><label className="pool-company-field-label" htmlFor="company-alias">名称别名</label><div className="pool-company-aliases"><span className="pool-company-alias">{company.name}</span>{aliases.map((name) => <button type="button" key={name} className="pool-company-alias" disabled={busy} aria-label={`移除别名${name}`} onClick={() => setAliases((previous) => previous.filter((item) => item !== name))}>{name} ×</button>)}</div>
      <div className="pool-company-alias-input"><Input id="company-alias" aria-label="添加公司别名" placeholder="输入别名，按回车添加" maxLength={200} value={alias} disabled={busy} onChange={(event) => setAlias(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addAlias(); } }} /><Button variant="outline" disabled={busy || !alias.trim()} onClick={addAlias}>添加</Button></div>
      <div className="pool-company-help"><p>匹配同一公司后，插件采集的 Logo 自动共享。</p><p>同名但不同公司的数据应保持独立；有多个匹配时不会自动关联。</p></div>
    </> : <><label className="pool-company-field-label" htmlFor="company-logo-url">新图标地址</label><PoolSearch id="company-logo-url" aria-label="新图标地址" placeholder="输入 HTTPS 图片地址" maxLength={2048} value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} /><p>保存后用于公共公司展示。已有个人记录保留原来的图标快照。</p></>}
    {error && <FeedbackNotice kind="error">{error}</FeedbackNotice>}
  </PoolDialog>;
}

import { useState, type ComponentProps, type ReactNode } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, SelectField } from "@/components/ui";
import searchIcon from "../../assets/figma/job-pool/search.svg";
import downIcon from "../../assets/figma/job-pool/down.svg";
import "./opportunities.css";

export type PoolCompany = { id: string; name: string; logo_url?: string | null; aliases?: string[] };

export function PoolCompanyLogo({ company, size = 24, jobTitle }: { company: Pick<PoolCompany, "name" | "logo_url">; size?: 24 | 32 | 40 | 48 | 64; jobTitle?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [showFailure, setShowFailure] = useState(false);
  const initial = [...company.name.trim()][0] || "企";
  return <><span className={`pool-company-logo pool-company-logo-${size}`}>
    {company.logo_url && failedUrl !== company.logo_url
      ? <img src={company.logo_url} alt={`${company.name} Logo`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(company.logo_url!)} />
      : failedUrl && company.logo_url === failedUrl
        ? <button type="button" className="pool-logo-fallback" aria-label={`查看${company.name}图标加载提示`} title="图标加载失败，点击查看或重试" onClick={() => setShowFailure(true)}>{initial}</button>
        : <span aria-hidden="true">{initial}</span>}
  </span>{showFailure && <PoolDialog title="图标加载失败" wide onClose={() => setShowFailure(false)} footer={<>
    <Button variant="outline" onClick={() => setShowFailure(false)}>关闭</Button>
    <Button onClick={() => { setFailedUrl(null); setShowFailure(false); }}>重新加载</Button>
  </>}>
    <div className="pool-logo-failure-example"><PoolCompanyLogo company={{ name: company.name }} size={40} /><span>{company.name}{jobTitle ? ` · ${jobTitle}` : ""}</span></div>
    <p>显示公司名称首字，岗位仍可查看和加入求职进程。</p>
  </PoolDialog>}</>;
}

export function PoolSearch(props: ComponentProps<typeof Input>) {
  return <label className="pool-search-field"><img src={searchIcon} alt="" /><Input {...props} /></label>;
}

export function PoolSelect(props: ComponentProps<typeof SelectField>) {
  return <span className="pool-filter"><SelectField {...props} /></span>;
}

export function PoolTag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "accent" }) {
  return <span className={`pool-tag pool-tag-${tone}`}>{children}</span>;
}

export function PoolDialog({ title, description, children, footer, onClose, wide = false, busy = false }: {
  title: string; description?: string; children?: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; busy?: boolean;
}) {
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className={`pool-theme pool-dialog${wide ? " pool-dialog-wide" : ""}`} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
      <DialogTitle>{title}</DialogTitle>
      {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
      {children}
      {footer && <div className="pool-dialog-actions">{footer}</div>}
    </DialogContent>
  </Dialog>;
}

export function PoolState({ title, description, children, error = false }: { title: string; description: string; children?: ReactNode; error?: boolean }) {
  return <section className="pool-empty" role={error ? "alert" : undefined}>
    <h2>{title}</h2><p>{description}</p>{children && <div className="pool-state-actions">{children}</div>}
  </section>;
}

export function CompanyPicker({ companies, selected, onApply, multiple = true }: {
  companies: PoolCompany[]; selected: string[]; onApply: (ids: string[]) => void; multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(selected);
  const [search, setSearch] = useState("");
  const selectedNames = companies.filter((c) => selected.includes(c.id)).map((c) => c.name);
  const options = companies.filter((c) => [c.name, ...(c.aliases ?? [])].some((v) => v.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const toggle = (id: string) => setDraft((old) => old.includes(id) ? old.filter((v) => v !== id) : multiple ? old.length < 200 ? [...old, id] : old : [id]);
  return <>
    <Button className="pool-company-trigger" variant="outline" aria-label="全部企业" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setDraft(selected); setSearch(""); setOpen(true); }}>
      <span>{selectedNames.length ? `${selectedNames[0]}${selectedNames.length > 1 ? ` 等 ${selectedNames.length} 家` : ""}` : "全部企业"}</span><img src={downIcon} alt="" />
    </Button>
    {open && <PoolDialog title="选择企业" onClose={() => setOpen(false)} footer={<>
      <Button variant="outline" onClick={() => setDraft([])}>清空</Button>
      <Button onClick={() => { onApply(draft); setOpen(false); }}>应用筛选</Button>
    </>}>
      <PoolSearch aria-label="搜索企业" placeholder={companies.some((company) => company.aliases?.length) ? "搜索公司名称 / 别名" : "搜索公司名称"} value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
      {draft.length > 0 && <div className="pool-selected-companies">{companies.filter((c) => draft.includes(c.id)).map((c) => <button key={c.id} type="button" className="pool-selected-company" onClick={() => toggle(c.id)} aria-label={`移除${c.name}`}>{c.name} ×</button>)}</div>}
      <p className="pool-picker-hint">已选 {draft.length} 家{multiple ? draft.length >= 200 ? " · 最多选择 200 家" : " · 可继续添加" : ""}</p>
      <div className="pool-company-options">{options.length ? options.map((company) => <label className="pool-company-option" key={company.id}>
        <input type="checkbox" aria-label={company.name} checked={draft.includes(company.id)} disabled={multiple && draft.length >= 200 && !draft.includes(company.id)} onChange={() => toggle(company.id)} />
        <PoolCompanyLogo company={company} /><span>{company.name}</span>
      </label>) : <p className="pool-muted">没有匹配的企业</p>}</div>
    </PoolDialog>}
  </>;
}

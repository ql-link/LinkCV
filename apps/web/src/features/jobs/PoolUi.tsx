import { useCallback, useRef, useState, type ReactNode } from "react";
import { Icon } from "../../v3/Icon";
import { Popover, SearchBox } from "../../v3/primitives";
import "./opportunities.css";

export type PoolCompany = { id: string; name: string; logo_url?: string | null; aliases?: string[] };

/** Company mark shared by the workspace and admin pages; a failed or missing image quietly falls back to the first character. */
export function PoolCompanyLogo({ company, size = 24 }: { company: Pick<PoolCompany, "name" | "logo_url">; size?: 20 | 24 | 32 | 40 | 48 | 64 }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initial = [...company.name.trim()][0] || "企";
  return <span className={`pool-company-logo pool-company-logo-${size}`}>
    {company.logo_url && failedUrl !== company.logo_url
      ? <img src={company.logo_url} alt={`${company.name} Logo`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(company.logo_url!)} />
      : <span aria-hidden="true">{initial}</span>}
  </span>;
}

export function PoolTag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" }) {
  return <span className={`v3-pill pool-tag pool-tag-${tone}`}>{children}</span>;
}

/** Searchable multi-select; every tick applies at once, so there is no draft state or confirm step. */
export function CompanyFilter({ companies, selected, onChange }: { companies: PoolCompany[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const close = useCallback(() => setOpen(false), []);
  const names = companies.filter((company) => selected.includes(company.id)).map((company) => company.name);
  const text = search.trim().toLocaleLowerCase();
  const options = companies.filter((company) => [company.name, ...(company.aliases ?? [])].some((name) => name.toLocaleLowerCase().includes(text)));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((value) => value !== id) : selected.length < 200 ? [...selected, id] : selected);
  return <>
    <button ref={anchor} type="button" className={`v3-select is-sm pool-company-trigger${names.length ? " is-active" : ""}`} aria-label="筛选企业" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setSearch(""); setOpen((value) => !value); }}>
      <span className="v3-select-value">{names.length ? `${names[0]}${names.length > 1 ? ` 等 ${names.length} 家` : ""}` : "企业"}</span>
      <Icon className="v3-select-chev" name="chevd" size={12} />
    </button>
    <Popover anchorRef={anchor} open={open} onClose={close} label="选择企业" className="pool-company-menu">
      <SearchBox label="搜索企业" placeholder="搜索公司名称 / 别名" value={search} onChange={setSearch} />
      <div className="pool-company-options">
        {options.length ? options.map((company) => <label className="pool-company-option" key={company.id}>
          <input type="checkbox" aria-label={company.name} checked={selected.includes(company.id)} disabled={selected.length >= 200 && !selected.includes(company.id)} onChange={() => toggle(company.id)} />
          <PoolCompanyLogo company={company} size={20} /><span>{company.name}</span>
        </label>) : <p className="pool-muted">没有匹配的企业</p>}
      </div>
      <div className="pool-company-menu-foot">
        <span>{selected.length ? `已选 ${selected.length} 家 · ${selected.length >= 200 ? "最多 200 家" : "勾选即生效"}` : "勾选即生效，未选显示全部企业"}</span>
        {selected.length > 0 && <button type="button" className="v3-link" onClick={() => onChange([])}>清空</button>}
      </div>
    </Popover>
  </>;
}

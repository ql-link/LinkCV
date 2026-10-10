import { t, useLocale } from "@/i18n";
import { useMemo, useState } from "react";

import type { DatasetRecord } from "../../../api/client";
import { Icon } from "../../../v3/Icon";
import { Dialog, DialogFooter, SearchBox } from "../../../v3/primitives";
import { FormatSquare } from "./DatasetArt";

// 「添加资料 → 从资料库选择」：把已有资料移进当前项目（多选）。
// 一份资料只属于一个项目：关联了面试场次的资料归求职进程，不出现在候选里。
export function LibraryPickerDialog({
  datasets,
  projectName,
  sourceLabel,
  onClose,
  onConfirm,
}: {
  /** 候选资料（已排除当前项目内与关联面试的资料） */
  datasets: DatasetRecord[];
  projectName: string;
  /** 资料当前所在位置的显示名 */
  sourceLabel: (dataset: DatasetRecord) => string;
  onClose: () => void;
  onConfirm: (ids: string[]) => Promise<void>;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyword = query.trim().toLocaleLowerCase();
  const visible = useMemo(
    () => datasets.filter((dataset) => !keyword || dataset.file_name.toLocaleLowerCase().includes(keyword)),
    [datasets, keyword],
  );
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const submit = async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(Array.from(selected));
    } catch {
      setError(t("移动失败，请稍后重试。"));
      setBusy(false);
    }
  };
  const label = t("从资料库选择");

  return (
    <Dialog width={520} label={label} className="ds-dialog" closable={!busy} onClose={() => { if (!busy) onClose(); }}>
      <div className="v3-dialog-body">
        <h2 className="v3-dialog-title">{label}</h2>
        <p className="v3-dialog-sub ds-one-line">{t("选中的资料会移到「{value0}」。", { value0: projectName })}</p>
        <div className="ds-picker-search">
          <SearchBox value={query} onChange={setQuery} placeholder={t("搜索资料…")} label={t("搜索资料")} />
        </div>
        <div className="ds-pick" role="group" aria-label={t("可选资料")} style={{ maxHeight: 300 }}>
          {visible.length === 0 && (
            <p className="ds-pick-empty">{datasets.length === 0 ? t("资料库里没有可以移入的资料") : t("没有匹配的资料。")}</p>
          )}
          {visible.map((dataset) => {
            const checked = selected.has(dataset.id);
            return (
              <button
                key={dataset.id}
                type="button"
                role="checkbox"
                aria-checked={checked}
                className="ds-pick-item ds-pick-file"
                disabled={busy}
                onClick={() => toggle(dataset.id)}
              >
                <FormatSquare dataset={dataset} />
                <span title={dataset.file_name}>{dataset.file_name}</span>
                <small>{sourceLabel(dataset)}</small>
                <span className={`ds-pick-box${checked ? " is-checked" : ""}`} aria-hidden="true">{checked && <Icon name="check" size={11} />}</span>
              </button>
            );
          })}
        </div>
        {error && <p className="ds-inline-error" role="alert">{error}</p>}
      </div>
      <DialogFooter>
        <button type="button" className="v3-btn v3-btn-ghost" style={{ width: 80 }} disabled={busy} onClick={onClose}>{t("取消")}</button>
        <button type="button" className="v3-btn v3-btn-dark" disabled={busy || selected.size === 0} onClick={() => void submit()}>
          {busy ? t("正在移动…") : selected.size > 0 ? t("移入 {value0} 份", { value0: selected.size }) : t("移入项目")}
        </button>
      </DialogFooter>
    </Dialog>
  );
}

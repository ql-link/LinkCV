import { t, useLocale } from "@/i18n";
import { useRef, useState } from "react";
import type { DatasetFolder, DatasetRecord } from "../../../api/client";
import { Icon } from "../../../v3/Icon";
import { Menu } from "../../../v3/primitives";
import { FolderStage } from "./DatasetArt";

export type FolderCardProps = {
  folder: DatasetFolder;
  // 文件夹里最近上传的资料（按上传时间倒序），用于缩略纸张和「最近上传」日期
  recent: DatasetRecord[];
  onClick: () => void;
  onRename: (folder: DatasetFolder) => void;
  onDelete: (folder: DatasetFolder) => void;
};

// 「今天」/「昨天」/「MM-DD」
export function relativeUploadDay(value: string, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (diff === 0) return withTime ? t("今天 {value0}", { value0: time }) : t("今天");
  if (diff === 1) return withTime ? t("昨天 {value0}", { value0: time }) : t("昨天");
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return date.getFullYear() === now.getFullYear() ? day : `${date.getFullYear()}-${day}`;
}

// 06.1 文件夹卡片（273×172）：浅底舞台里排 1–3 张缩略纸张 → 名称 → 「N 份资料 · 最近上传 今天」，右侧 ⋯ 菜单
export function FolderCard({ folder, recent, onClick, onRename, onDelete }: FolderCardProps) {
  useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const count = folder.dataset_count;
  const latest = recent[0];
  const meta = count === 0
    ? t("还没有资料 · 进入后添加")
    : latest
      ? t("{value0} 份资料 · 最近上传 {value1}", { value0: count, value1: relativeUploadDay(latest.created_at) })
      : t("{value0} 份资料", { value0: count });

  return (
    <div
      className="ds-folder"
      role="button"
      tabIndex={0}
      aria-label={t("打开项目「{value0}」", { value0: folder.name })}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <FolderStage samples={count === 0 ? [] : recent} />
      <span className="ds-folder-name" title={folder.name}>{folder.name}</span>
      <span className="ds-folder-meta">{meta}</span>
      <button
        ref={moreRef}
        type="button"
        className="v3-icon-btn ds-folder-more"
        aria-label={t("项目「{value0}」操作菜单", { value0: folder.name })}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((value) => !value);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Icon name="more" size={14} />
      </button>
      {/* 菜单渲染在 portal 里，但 React 事件仍沿组件树冒泡：拦住它，避免点菜单项时顺带打开文件夹 */}
      <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <Menu
          anchorRef={moreRef}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          placement="bottom-end"
          label={t("{value0} 操作", { value0: folder.name })}
          width={176}
          items={[
            { label: t("重命名"), icon: "edit", onSelect: () => onRename(folder) },
            { kind: "separator" },
            { label: t("删除项目及资料"), icon: "trash", danger: true, title: t("项目里的资料会一起永久删除"), onSelect: () => onDelete(folder) },
          ]}
        />
      </span>
    </div>
  );
}

// 新建文件夹卡：虚线边框 + 圆形加号
export function CreateFolderCard({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  useLocale();
  return (
    <button type="button" className="ds-new-folder" aria-label={t("新建项目")} disabled={disabled} onClick={onClick}>
      <span className="ds-new-folder-plus" aria-hidden="true"><Icon name="plus" size={16} /></span>
      <strong>{t("新建项目")}</strong>
      <small>{t("把同一件事的资料放在一起")}</small>
    </button>
  );
}

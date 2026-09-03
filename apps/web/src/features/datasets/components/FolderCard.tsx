import { useState } from "react";
import { FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { DatasetFolder } from "../../../api/client";

export type FolderCardProps = {
  folder: DatasetFolder;
  onClick: () => void;
  onRename: (folder: DatasetFolder) => void;
  onDelete: (folder: DatasetFolder) => void;
};

export function FolderCard({
  folder,
  onClick,
  onRename,
  onDelete,
}: FolderCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isEmpty = folder.dataset_count === 0;

  return (
    <div
      className={`macos-folder-item${isEmpty ? " is-empty" : " has-files"}`}
      role="button"
      tabIndex={0}
      aria-label={`打开文件夹「${folder.name}」`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* 顶部：macOS 原生矢量风格文件夹图标 */}
      <div className="macos-folder-graphic" aria-hidden="true">
        {/* 后盖与折耳 */}
        <svg
          className="macos-folder-svg-back"
          viewBox="0 0 108 84"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`fb-${folder.id}`} x1="0" y1="0" x2="0" y2="84" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#5ea7f8" />
              <stop offset="100%" stopColor="#257ef5" />
            </linearGradient>
          </defs>
          {/* 左上圆润折耳 Tab + 主背板 */}
          <path
            d="M6 10C6 5.58 9.58 2 14 2H38C42 2 45.5 4.2 47.8 7.5L52 13H96C100.42 13 104 16.58 104 21V72C104 76.42 100.42 80 96 80H12C7.58 80 4 76.42 4 72V12C4 10.9 4.9 10 6 10Z"
            fill={`url(#fb-${folder.id})`}
          />
        </svg>

        {/* 探出的立体纸张卡片装饰（有文件时显示，悬停上浮） */}
        {!isEmpty && (
          <div className="macos-folder-papers">
            {folder.dataset_count > 1 && <div className="macos-paper-sheet is-back" />}
            <div className="macos-paper-sheet is-front">
              <div className="macos-paper-line is-long" />
              <div className="macos-paper-line is-medium" />
              <div className="macos-paper-line is-short" />
            </div>
          </div>
        )}

        {/* 前盖 */}
        <svg
          className="macos-folder-svg-front"
          viewBox="0 0 108 66"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`ff-${folder.id}`} x1="0" y1="0" x2="0" y2="66" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#7ec5ff" />
              <stop offset="40%" stopColor="#3d97f8" />
              <stop offset="100%" stopColor="#1a7cf2" />
            </linearGradient>
            <linearGradient id={`fg-${folder.id}`} x1="0" y1="0" x2="108" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="rgba(255,255,255,0.7)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0.25)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.6)" />
            </linearGradient>
          </defs>
          {/* 前盖梯形立体面板 */}
          <path
            d="M3 8C3 3.58 6.58 0 11 0H97C101.42 0 105 3.58 105 8L103 56C103 60.42 99.42 64 95 64H13C8.58 64 5 60.42 5 56L3 8Z"
            fill={`url(#ff-${folder.id})`}
          />
          {/* 顶边微高光线 */}
          <path
            d="M11 1H97C100.8 1 103.9 4 104 7.8L103.8 12H4.2L4 7.8C4.1 4 7.2 1 11 1Z"
            fill={`url(#fg-${folder.id})`}
            opacity="0.6"
          />
        </svg>
      </div>

      {/* 底部：操作框（文件夹名称、数量与菜单） */}
      <div className="macos-folder-caption">
        <span className="macos-folder-name" title={folder.name}>
          {folder.name}
        </span>

        <div className="macos-folder-subrow">
          <span className="macos-folder-badge">
            {isEmpty ? "空" : `${folder.dataset_count} 项`}
          </span>

          <div
            className="macos-folder-actions"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="macos-folder-menu-btn"
              aria-label={`文件夹「${folder.name}」操作菜单`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((val) => !val)}
            >
              <MoreHorizontal size={13} aria-hidden="true" />
            </button>

            {menuOpen && (
              <div
                className="dataset-action-menu macos-folder-menu"
                role="menu"
                aria-label={`${folder.name} 操作`}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onRename(folder);
                  }}
                >
                  <Pencil size={14} aria-hidden="true" />
                  重命名
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(folder);
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  删除文件夹
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CreateFolderCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="macos-create-folder-item"
      aria-label="新建文件夹"
      onClick={onClick}
    >
      <div className="macos-create-folder-icon-wrap" aria-hidden="true">
        <FolderPlus size={28} strokeWidth={1.5} className="macos-create-icon" />
      </div>
      <span className="macos-create-label">新建文件夹</span>
    </button>
  );
}

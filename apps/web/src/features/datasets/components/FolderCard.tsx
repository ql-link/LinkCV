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
      {/* 文件夹图形区域（统一坐标体系：100x80） */}
      <div className="macos-folder-graphic" aria-hidden="true">
        {/* 后盖与折耳 Tab（浅蓝色系渐变） */}
        <svg
          className="macos-folder-svg-back"
          viewBox="0 0 100 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`fb-${folder.id}`} x1="0" y1="4" x2="0" y2="78" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#6cb3f9" />
              <stop offset="100%" stopColor="#3d97f2" />
            </linearGradient>
          </defs>
          <path
            d="M8 16V12C8 7.5 11.5 4 16 4H38C41.5 4 44.7 6 46.5 9.2L50 15H88C92.5 15 96 18.5 96 23V70C96 74.5 92.5 78 88 78H12C7.5 78 4 74.5 4 70V23C4 19.5 6 16.5 8 16Z"
            fill={`url(#fb-${folder.id})`}
          />
        </svg>

        {/* 探出的立体纸张卡片装饰（有文件时出现） */}
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

        {/* 前盖（浅蓝色立体高光渐变） */}
        <svg
          className="macos-folder-svg-front"
          viewBox="0 0 100 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`ff-${folder.id}`} x1="0" y1="21" x2="0" y2="78" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#95ceff" />
              <stop offset="42%" stopColor="#5eaef8" />
              <stop offset="100%" stopColor="#348ee8" />
            </linearGradient>
            <linearGradient id={`fg-${folder.id}`} x1="4" y1="21" x2="96" y2="21" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="rgba(255,255,255,0.75)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0.3)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.65)" />
            </linearGradient>
          </defs>
          {/* 前盖主体 */}
          <path
            d="M4 28C4 24 7.5 21 12 21H88C92.5 21 96 24 96 28L94 70C94 74.5 90.5 78 86 78H14C9.5 78 6 74.5 6 70L4 28Z"
            fill={`url(#ff-${folder.id})`}
          />
          {/* 顶边微高光条 */}
          <path
            d="M12 22H88C91 22 93.5 23.5 94.5 25.5H5.5C6.5 23.5 9 22 12 22Z"
            fill={`url(#fg-${folder.id})`}
            opacity="0.7"
          />
        </svg>
      </div>

      {/* 底部信息与操作框 */}
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

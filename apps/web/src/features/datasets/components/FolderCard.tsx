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
        {/* 后盖与折耳 Tab */}
        <svg
          className="macos-folder-svg-back"
          viewBox="0 0 100 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`fb-${folder.id}`} x1="0" y1="5" x2="0" y2="78" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#3d82f6" />
              <stop offset="100%" stopColor="#145ed6" />
            </linearGradient>
          </defs>
          <path
            d="M8 12C8 8.5 11 5.5 15 5.5H36C39 5.5 42 7.5 44 10.5L48 15.5H88C92 15.5 95 18.5 95 22.5V71C95 75 92 78 88 78H12C8 78 5 75 5 71V19C5 16 7 14 10 14H8Z"
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

        {/* 前盖（坐标完全与后盖对齐） */}
        <svg
          className="macos-folder-svg-front"
          viewBox="0 0 100 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`ff-${folder.id}`} x1="0" y1="21" x2="0" y2="78" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#5499fa" />
              <stop offset="45%" stopColor="#2573e8" />
              <stop offset="100%" stopColor="#145ed6" />
            </linearGradient>
            <linearGradient id={`fg-${folder.id}`} x1="5" y1="21" x2="95" y2="21" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="rgba(255,255,255,0.65)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0.25)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.55)" />
            </linearGradient>
          </defs>
          {/* 前盖主体 */}
          <path
            d="M5 28C5 24 8 21 12 21H88C92 21 95 24 95 28L93 71C93 75 90 78 86 78H14C10 78 7 75 7 71L5 28Z"
            fill={`url(#ff-${folder.id})`}
          />
          {/* 顶边高光条 */}
          <path
            d="M12 22H88C90.5 22 92.5 23.5 93 25.5H7C7.5 23.5 9.5 22 12 22Z"
            fill={`url(#fg-${folder.id})`}
            opacity="0.65"
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

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
      className={`macos-folder-card${isEmpty ? " is-empty" : " has-files"}`}
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
      {/* 文件夹图形区域 */}
      <div className="macos-folder-visual" aria-hidden="true">
        {/* 后盖 */}
        <svg
          className="macos-folder-svg-back"
          viewBox="0 0 120 90"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`fbGrad-${folder.id}`} x1="0" y1="0" x2="0" y2="90" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#5ea7f8" />
              <stop offset="100%" stopColor="#2c80ef" />
            </linearGradient>
          </defs>
          <path
            d="M8 12C8 6.477 12.477 2 18 2H42C46.5 2 50.2 4.6 52.8 8.4L57 14H104C109.523 14 114 18.477 114 24V78C114 83.523 109.523 88 104 88H8C2.477 88 -2 83.523 -2 78V18C-2 14.686 0.686 12 4 12H8Z"
            fill={`url(#fbGrad-${folder.id})`}
          />
        </svg>

        {/* 探出的纸质卡片装饰（仅有文件时显示，悬停上浮） */}
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
          viewBox="0 0 120 74"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`ffGrad-${folder.id}`} x1="0" y1="0" x2="0" y2="74" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#76bcff" />
              <stop offset="45%" stopColor="#3b92f7" />
              <stop offset="100%" stopColor="#1f7df2" />
            </linearGradient>
            <linearGradient id={`fgGrad-${folder.id}`} x1="0" y1="0" x2="120" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="rgba(255,255,255,0.6)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0.2)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.5)" />
            </linearGradient>
          </defs>
          <path
            d="M2 10C2 4.477 6.477 0 12 0H108C113.523 0 118 4.477 118 10L116 64C116 69.523 111.523 74 106 74H14C8.477 74 4 69.523 4 64L2 10Z"
            fill={`url(#ffGrad-${folder.id})`}
          />
          <path
            d="M12 1.5H108C112.694 1.5 116.5 5.306 116.5 10L116.3 16H3.7L3.5 10C3.5 5.306 7.306 1.5 12 1.5Z"
            fill={`url(#fgGrad-${folder.id})`}
            opacity="0.5"
          />
        </svg>
      </div>

      {/* 文件夹下方：名称与操作框 */}
      <div className="macos-folder-footer">
        <div className="macos-folder-info">
          <span className="macos-folder-name" title={folder.name}>
            {folder.name}
          </span>
          <span className="macos-folder-count">
            {isEmpty ? "空文件夹" : `${folder.dataset_count} 份资料`}
          </span>
        </div>

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
            <MoreHorizontal size={14} aria-hidden="true" />
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
  );
}

export function CreateFolderCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="macos-create-folder-card"
      aria-label="新建文件夹"
      onClick={onClick}
    >
      <div className="macos-create-folder-icon-box">
        <FolderPlus size={32} className="macos-create-folder-icon" aria-hidden="true" />
      </div>
      <div className="macos-create-folder-footer">
        <span className="macos-create-folder-label">新建文件夹</span>
        <span className="macos-create-folder-sub">点击创建</span>
      </div>
    </button>
  );
}

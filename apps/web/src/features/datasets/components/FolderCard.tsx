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
      {/* 文件夹图形区域（统一 100x80 画布坐标） */}
      <div className="macos-folder-graphic" aria-hidden="true">
        {/* 后盖与折耳 Tab（经典 macOS 浅蓝渐变） */}
        <svg
          className="macos-folder-svg-back"
          viewBox="0 0 100 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`fb-${folder.id}`} x1="0" y1="8" x2="0" y2="77" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#74b8f8" />
              <stop offset="100%" stopColor="#3e95f2" />
            </linearGradient>
            <linearGradient id={`fi-${folder.id}`} x1="0" y1="17" x2="0" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="rgba(15, 70, 150, 0.22)" />
              <stop offset="100%" stopColor="rgba(15, 70, 150, 0)" />
            </linearGradient>
          </defs>
          {/* 左侧无缝连续平滑曲线，X=6 垂直贯通无凹坑 */}
          <path
            d="M6 16C6 11.5 9.5 8 14 8H36C39.5 8 42.5 9.8 44.5 12.8L47.5 17H86C90.5 17 94 20.5 94 25V69C94 73.5 90.5 77 86 77H14C9.5 77 6 73.5 6 69V16Z"
            fill={`url(#fb-${folder.id})`}
          />
          {/* 内里轻微阴影营造开口深度感 */}
          <path
            d="M6 25H94V32H6V25Z"
            fill={`url(#fi-${folder.id})`}
          />
        </svg>

        {/* 探出的立体纸质卡片装饰（有文件时显示） */}
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

        {/* 前盖（优雅浅天蓝渐变与细微顶边反光线） */}
        <svg
          className="macos-folder-svg-front"
          viewBox="0 0 100 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`ff-${folder.id}`} x1="0" y1="19" x2="0" y2="77" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#a0d5ff" />
              <stop offset="38%" stopColor="#68b4f9" />
              <stop offset="100%" stopColor="#3b94f3" />
            </linearGradient>
          </defs>
          {/* 前盖主体：左右严格对齐 X=6 与 X=94，底边对齐 Y=77 */}
          <path
            d="M6 27C6 22.5 9.5 19 14 19H86C90.5 19 94 22.5 94 27V69C94 73.5 90.5 77 86 77H14C9.5 77 6 73.5 6 69V27Z"
            fill={`url(#ff-${folder.id})`}
          />
          {/* 顶边微高光细线，杜绝粗糙胶囊光斑 */}
          <path
            d="M14 19.6H86"
            stroke="rgba(255, 255, 255, 0.8)"
            strokeWidth="1.2"
            strokeLinecap="round"
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

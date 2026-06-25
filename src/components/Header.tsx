import {
  FileDown,
  FileText,
  Home,
  List,
  LogOut,
  Puzzle,
  Save,
  SwatchBook,
} from "lucide-react";
import { useResumeStore } from "../store/resumeStore";
import { exportResumePdf } from "../features/preview/exportPdf";

const menuItems = [
  { label: "文件", icon: FileText },
  { label: "编辑模式", icon: List },
  { label: "选择主题", icon: SwatchBook },
  { label: "插件列表", icon: Puzzle },
  { label: "图标列表", icon: List },
];

export function Header() {
  const title = useResumeStore((state) => state.title);
  const setTitle = useResumeStore((state) => state.setTitle);
  const smartOnePage = useResumeStore((state) => state.settings.smartOnePage);
  const user = useResumeStore((state) => state.user);
  const saveStatus = useResumeStore((state) => state.saveStatus);
  const dirty = useResumeStore((state) => state.dirty);
  const saveCurrentResume = useResumeStore((state) => state.saveCurrentResume);
  const goHome = useResumeStore((state) => state.goHome);
  const logout = useResumeStore((state) => state.logout);

  return (
    <header className="top-header">
      <div className="header-left">
        <button className="icon-button ghost" aria-label="回主页" onClick={goHome}>
          <Home size={16} />
        </button>
        <input
          className="document-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="简历标题"
        />
        <nav className="header-menu" aria-label="全局菜单">
          {menuItems.map((item) => (
            <button className="menu-button" key={item.label}>
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="header-actions">
        <span className="save-status">
          {saveStatus === "saving"
            ? "保存中"
            : saveStatus === "saved" && !dirty
              ? "已保存"
              : dirty
                ? "未保存"
                : user?.email}
        </span>
        <button className="secondary-action" onClick={() => void exportResumePdf(smartOnePage, title)}>
          <FileDown size={14} />
          导出 PDF
        </button>
        <button className="primary-action" onClick={() => void saveCurrentResume()}>
          <Save size={14} />
          保存
        </button>
        <button className="icon-button ghost" title="退出登录" onClick={() => void logout()}>
          <LogOut size={15} />
        </button>
      </div>
    </header>
  );
}

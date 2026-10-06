import { Icon } from "../../v3/Icon";

// 面板卡片标题区（Figma lib12 · ewDrawer）：标题 16 Medium、说明 11.5、右上角关闭（旋转 45° 的加号），下方一条分隔线（y=72）
export function WorkbenchPanelHeader({
  titleId,
  title,
  subtitle,
  closeLabel,
  onClose,
}: {
  titleId: string;
  title: string;
  subtitle?: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <header className="wb3-panel-head">
      <span>
        <h2 id={titleId}>{title}</h2>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
      <button type="button" className="wb3-panel-close" onClick={onClose} aria-label={closeLabel}>
        <Icon name="x" size={16} />
      </button>
    </header>
  );
}

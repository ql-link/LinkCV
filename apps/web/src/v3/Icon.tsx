import type { CSSProperties } from "react";
import { V3_ICON_PATHS, type V3IconName } from "./iconPaths";

// V3 设计稿的线性图标：24×24 视图框、1.8 描边、圆角端点，颜色跟随 currentColor
export function Icon({
  name,
  size = 14,
  className,
  style,
  strokeWidth = 1.8,
}: {
  name: V3IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}) {
  const body = V3_ICON_PATHS[name].split("CUR").join("currentColor");
  return (
    <svg
      aria-hidden="true"
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}

export type { V3IconName };

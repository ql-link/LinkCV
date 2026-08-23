export const DEFAULT_PRODUCTION_ORIGIN = "https://linkresume.cn";
export const DEFAULT_DEV_URL = "http://127.0.0.1:5173";

export type DesktopMode = "dev" | "package";

export interface DesktopTarget {
  mode: DesktopMode;
  /** 窗口初始加载的地址（package 模式为生产源根地址）。 */
  loadUrl: string;
  /** 允许窗口内导航的源。 */
  origin: string;
  /** 配置解析中产生的告警（非法值回落默认时记录）。 */
  warnings: string[];
}

export interface DesktopEnv {
  LINKCV_DESKTOP_ORIGIN?: string;
  LINKCV_DESKTOP_DEV_URL?: string;
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

export function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function shouldAllowNavigation(
  url: string,
  target: DesktopTarget,
): boolean {
  if (url === "about:blank") return true;
  return isSameOrigin(url, target.origin);
}

function normalizeHttpOrigin(
  raw: string | undefined,
  field: string,
  warnings: string[],
): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    warnings.push(`${field} 不是合法 URL，已回落默认值：${raw}`);
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    warnings.push(`${field} 必须使用 http(s) 协议，已回落默认值：${raw}`);
    return null;
  }
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    warnings.push(`${field} 仅允许在回环地址使用 http，已回落默认值：${raw}`);
    return null;
  }
  return parsed.origin;
}

export function resolveDesktopTarget(
  mode: DesktopMode,
  env: DesktopEnv,
): DesktopTarget {
  const warnings: string[] = [];
  if (mode === "dev") {
    const devUrl =
      normalizeHttpOrigin(env.LINKCV_DESKTOP_DEV_URL, "LINKCV_DESKTOP_DEV_URL", warnings) ??
      DEFAULT_DEV_URL;
    return { mode, loadUrl: devUrl, origin: devUrl, warnings };
  }
  const origin =
    normalizeHttpOrigin(env.LINKCV_DESKTOP_ORIGIN, "LINKCV_DESKTOP_ORIGIN", warnings) ??
    DEFAULT_PRODUCTION_ORIGIN;
  return { mode, loadUrl: origin, origin, warnings };
}

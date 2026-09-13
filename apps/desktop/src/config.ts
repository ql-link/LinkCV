export const DEFAULT_PRODUCTION_ORIGIN = "https://linkresume.cn";
export const DEFAULT_DEVELOPMENT_ORIGIN = "http://100.86.10.52:18002";
export const DEFAULT_DEV_URL = "http://127.0.0.1:5173";
/** 打包模式的工作区入口：已登录直接进入，未登录由网页端守卫自动转入登录页。 */
export const PACKAGE_ENTRY_PATH = "/resumes";

export type DesktopMode = "dev" | "package";
export type DesktopPreset = "production" | "development";

export interface DesktopTarget {
  mode: DesktopMode;
  preset: DesktopPreset;
  /** 窗口初始加载的地址（package 模式为环境源 + 工作区入口）。 */
  loadUrl: string;
  /** 允许窗口内导航的源。 */
  origin: string;
  /** 配置解析中产生的告警（非法值回落默认或非安全连接时记录）。 */
  warnings: string[];
}

export interface DesktopEnv {
  LINKCV_DESKTOP_ENV?: string;
  LINKCV_DESKTOP_ORIGIN?: string;
  LINKCV_DESKTOP_DEV_URL?: string;
}

/** 打包时由构建脚本写入 dist/built-in-env.json 的目标环境。 */
export interface BuiltInDesktopEnv {
  env?: DesktopPreset;
  origin?: string;
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
  allowInsecureHttp: boolean,
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
  if (
    parsed.protocol === "http:" &&
    !isLoopbackHostname(parsed.hostname) &&
    !allowInsecureHttp
  ) {
    warnings.push(`${field} 仅允许在回环地址使用 http，已回落默认值：${raw}`);
    return null;
  }
  if (
    parsed.protocol === "http:" &&
    !isLoopbackHostname(parsed.hostname) &&
    allowInsecureHttp
  ) {
    warnings.push(`${field} 使用非回环 http 非安全连接：${parsed.origin}`);
  }
  return parsed.origin;
}

export function resolveDesktopTarget(
  mode: DesktopMode,
  env: DesktopEnv,
  builtIn: BuiltInDesktopEnv | null = null,
): DesktopTarget {
  const warnings: string[] = [];
  if (mode === "dev") {
    const devUrl =
      normalizeHttpOrigin(env.LINKCV_DESKTOP_DEV_URL, "LINKCV_DESKTOP_DEV_URL", warnings, false) ??
      DEFAULT_DEV_URL;
    return { mode, preset: "development", loadUrl: devUrl, origin: devUrl, warnings };
  }

  let preset: DesktopPreset = "production";
  const requested = env.LINKCV_DESKTOP_ENV ?? builtIn?.env;
  if (requested === "development" || requested === "production") {
    preset = requested;
  } else if (requested !== undefined) {
    warnings.push(`LINKCV_DESKTOP_ENV 仅支持 development/production，已按 production 处理：${requested}`);
  }

  const defaultOrigin =
    preset === "development" ? DEFAULT_DEVELOPMENT_ORIGIN : DEFAULT_PRODUCTION_ORIGIN;
  const origin =
    normalizeHttpOrigin(
      env.LINKCV_DESKTOP_ORIGIN ?? builtIn?.origin,
      "LINKCV_DESKTOP_ORIGIN",
      warnings,
      preset === "development",
    ) ?? defaultOrigin;
  return {
    mode,
    preset,
    loadUrl: `${origin}${PACKAGE_ENTRY_PATH}`,
    origin,
    warnings,
  };
}

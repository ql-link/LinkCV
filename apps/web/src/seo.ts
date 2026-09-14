import type { AppRoute } from "./routing";

export const SITE_URL = "https://linkresume.cn";
export const SITE_NAME = "LinkResume";
export const SITE_TITLE = "LinkResume - AI 简历制作、优化与求职管理";
export const SITE_DESCRIPTION = "LinkResume 是面向中文求职者的一站式 AI 求职平台，提供简历制作与优化、版本管理、PDF 导出、岗位追踪和面试复盘，让求职过程更清晰、更高效。";
export const SOCIAL_DESCRIPTION = "从简历制作与优化，到岗位追踪和面试复盘，LinkResume 帮你清晰管理求职过程中的每一步。";

const privateRouteTitles: Partial<Record<AppRoute["kind"], string>> = {
  account: "账号设置 | LinkResume",
  admin: "管理后台 | LinkResume",
  adminLogin: "管理员登录 | LinkResume",
  assistant: "AI 求职助手 | LinkResume",
  auth: "登录与注册 | LinkResume",
  datasets: "资料库 | LinkResume",
  editor: "简历编辑器 | LinkResume",
  interviews: "求职中心 | LinkResume",
  jobDetail: "岗位详情 | LinkResume",
  notFound: "页面不存在 | LinkResume",
  resumeCreate: "创建简历 | LinkResume",
  resumes: "我的简历 | LinkResume",
  share: "公开简历 | LinkResume",
  templates: "简历模板 | LinkResume",
};

function upsertMeta(selector: string, attributes: Record<string, string>, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    document.head.append(element);
  }
  element.content = content;
}

function removeMeta(selector: string) {
  document.head.querySelector(selector)?.remove();
}

function setCanonical(href: string | null) {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    existing?.remove();
    return;
  }
  const link = existing ?? document.createElement("link");
  link.rel = "canonical";
  link.href = href;
  if (!existing) document.head.append(link);
}

export function applyRouteSeo(route: AppRoute) {
  const isLanding = route.kind === "landing";
  const title = isLanding ? SITE_TITLE : privateRouteTitles[route.kind] ?? SITE_NAME;
  document.title = title;

  upsertMeta('meta[name="description"]', { name: "description" }, isLanding ? SITE_DESCRIPTION : "LinkResume AI 简历制作与求职管理平台。此页面不对搜索引擎开放索引。");
  upsertMeta(
    'meta[name="robots"]',
    { name: "robots" },
    isLanding
      ? "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
      : "noindex, nofollow, noarchive",
  );
  setCanonical(isLanding ? `${SITE_URL}/` : null);

  if (isLanding) {
    upsertMeta('meta[property="og:title"]', { property: "og:title" }, SITE_TITLE);
    upsertMeta('meta[property="og:description"]', { property: "og:description" }, SOCIAL_DESCRIPTION);
    upsertMeta('meta[property="og:url"]', { property: "og:url" }, `${SITE_URL}/`);
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title" }, SITE_TITLE);
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description" }, SOCIAL_DESCRIPTION);
  } else {
    removeMeta('meta[property="og:title"]');
    removeMeta('meta[property="og:description"]');
    removeMeta('meta[property="og:url"]');
    removeMeta('meta[name="twitter:title"]');
    removeMeta('meta[name="twitter:description"]');
  }
}

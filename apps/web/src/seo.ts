import { t } from "./i18n";
import type { AppRoute } from "./routing";

export const SITE_URL = "https://linkresume.cn";
export const SITE_NAME = "DrawOffer";
export const SITE_TITLE = "DrawOffer - AI 简历制作、优化与求职管理";
export const SITE_DESCRIPTION = "DrawOffer 是面向中文求职者的一站式 AI 求职平台，提供简历制作与优化、版本管理、PDF 导出、岗位追踪和面试复盘，让求职过程更清晰、更高效。";
export const SOCIAL_DESCRIPTION = "从简历制作与优化，到岗位追踪和面试复盘，DrawOffer 帮你清晰管理求职过程中的每一步。";

const privateRouteTitles: Partial<Record<AppRoute["kind"], string>> = {
  accountDeletion: "账号注销进度 | DrawOffer",
  account: "账号设置 | DrawOffer",
  admin: "管理后台 | DrawOffer",
  adminLogin: "管理员登录 | DrawOffer",
  assistant: "AI 求职助手 | DrawOffer",
  auth: "登录与注册 | DrawOffer",
  datasets: "资料库 | DrawOffer",
  editor: "简历编辑器 | DrawOffer",
  interviews: "求职中心 | DrawOffer",
  jobDetail: "岗位详情 | DrawOffer",
  mockInterview: "模拟面试 | DrawOffer",
  notFound: "页面不存在 | DrawOffer",
  resumeCreate: "创建简历 | DrawOffer",
  resumes: "我的简历 | DrawOffer",
  share: "公开简历 | DrawOffer",
  templates: "简历模板 | DrawOffer",
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
  const title = isLanding ? SITE_TITLE : (privateRouteTitles[route.kind] ? `${t(privateRouteTitles[route.kind]!.replace(" | DrawOffer", ""))} | DrawOffer` : SITE_NAME);
  document.title = title;

  upsertMeta('meta[name="description"]', { name: "description" }, isLanding ? SITE_DESCRIPTION : "DrawOffer AI 简历制作与求职管理平台。此页面不对搜索引擎开放索引。");
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

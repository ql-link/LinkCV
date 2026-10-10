import { defineConfig } from "wxt";

// Accept the pre-rename build variables during the compatibility window.
for (const name of ["WXT_PUBLIC_DRAWOFFER_CHANNEL", "WXT_PUBLIC_DRAWOFFER_ORIGIN"]) {
  const legacy = name.replace("DRAWOFFER", "LINKRESUME");
  if (!process.env[name] && process.env[legacy]) {
    console.warn(`${legacy} is deprecated; rename it to ${name}`);
    process.env[name] = process.env[legacy];
  }
}

const localDrawOfferPermissions = [
  "http://127.0.0.1:5173/*",
  "http://localhost:5173/*",
];

const bossPermissions = [
  "https://zhipin.com/*",
  "https://www.zhipin.com/*",
  "https://m.zhipin.com/*",
  "https://img.bosszhipin.com/*",
  "https://img2.bosszhipin.com/*",
];

const isReleaseBuild = process.env.WXT_RELEASE_BUILD === "1";
const releaseChannel = process.env.WXT_PUBLIC_DRAWOFFER_CHANNEL?.trim();
const isDevelopmentBuild =
  releaseChannel === "development" || !isReleaseBuild;

function configuredDrawOfferPermission(): string[] {
  const configured = process.env.WXT_PUBLIC_DRAWOFFER_ORIGIN?.trim();
  if (!configured) return [];
  try {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/') return [];
    return [`${url.origin}/*`];
  } catch {
    return [];
  }
}

if (isReleaseBuild && releaseChannel !== "development" && releaseChannel !== "production") {
  throw new Error(
    "Release builds require WXT_PUBLIC_DRAWOFFER_CHANNEL=development or production.",
  );
}
if (isReleaseBuild && configuredDrawOfferPermission().length !== 1) {
  throw new Error("Release builds require one valid WXT_PUBLIC_DRAWOFFER_ORIGIN.");
}

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: isDevelopmentBuild ? "DrawOffer 岗位采集（开发版）" : "DrawOffer 岗位采集",
    description: "从当前 BOSS 直聘岗位详情页提取信息，经确认后导入 DrawOffer。",
    icons: {
      16: "drawoffer-mark.png",
      32: "drawoffer-mark.png",
      48: "drawoffer-mark.png",
      128: "drawoffer-mark.png",
    },
    permissions: ["activeTab"],
    host_permissions: [
      ...bossPermissions,
      ...(isReleaseBuild ? [] : localDrawOfferPermissions),
      ...configuredDrawOfferPermission(),
    ],
    action: {
      default_title: isDevelopmentBuild
        ? "导入当前岗位到 DrawOffer（开发环境）"
        : "导入当前岗位到 DrawOffer",
      default_icon: {
        16: "drawoffer-mark.png",
        32: "drawoffer-mark.png",
      },
    },
  },
});

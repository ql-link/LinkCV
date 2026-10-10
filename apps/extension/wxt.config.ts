import { defineConfig } from "wxt";

const localLinkResumePermissions = [
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
const releaseChannel = process.env.WXT_PUBLIC_LINKRESUME_CHANNEL?.trim();
const isDevelopmentBuild =
  releaseChannel === "development" || !isReleaseBuild;

function configuredLinkResumePermission(): string[] {
  const configured = process.env.WXT_PUBLIC_LINKRESUME_ORIGIN?.trim();
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
    "Release builds require WXT_PUBLIC_LINKRESUME_CHANNEL=development or production.",
  );
}
if (isReleaseBuild && configuredLinkResumePermission().length !== 1) {
  throw new Error("Release builds require one valid WXT_PUBLIC_LINKRESUME_ORIGIN.");
}

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: isDevelopmentBuild ? "LinkResume 求职助手（开发版）" : "LinkResume 求职助手",
    description: "采集岗位到 LinkResume，使用本人简历填写网申表单。",
    icons: {
      16: "linkresume-mark.png",
      32: "linkresume-mark.png",
      48: "linkresume-mark.png",
      128: "linkresume-mark.png",
    },
    permissions: ["activeTab", "scripting", "storage", "sidePanel"],
    optional_host_permissions: ["https://*/*", "http://*/*"],
    host_permissions: [
      ...bossPermissions,
      ...(isReleaseBuild ? [] : localLinkResumePermissions),
      ...configuredLinkResumePermission(),
    ],
    action: {
      default_title: isDevelopmentBuild
        ? "导入当前岗位到 LinkResume（开发环境）"
        : "导入当前岗位到 LinkResume",
      default_icon: {
        16: "linkresume-mark.png",
        32: "linkresume-mark.png",
      },
    },
  },
});

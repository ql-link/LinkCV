import { defineConfig } from "wxt";

const localLinkCVPermissions = [
  "http://127.0.0.1:5173/*",
  "http://localhost:5173/*",
];

const bossPermissions = [
  "https://zhipin.com/*",
  "https://www.zhipin.com/*",
  "https://m.zhipin.com/*",
];

const isReleaseBuild = process.env.WXT_RELEASE_BUILD === "1";
const releaseChannel = process.env.WXT_PUBLIC_LINKCV_CHANNEL?.trim();
const isDevelopmentBuild =
  releaseChannel === "development" || !isReleaseBuild;

function configuredLinkCVPermission(): string[] {
  const configured = process.env.WXT_PUBLIC_LINKCV_ORIGIN?.trim();
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
    "Release builds require WXT_PUBLIC_LINKCV_CHANNEL=development or production.",
  );
}
if (isReleaseBuild && configuredLinkCVPermission().length !== 1) {
  throw new Error("Release builds require one valid WXT_PUBLIC_LINKCV_ORIGIN.");
}

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: isDevelopmentBuild ? "LinkResume 岗位采集（开发版）" : "LinkResume 岗位采集",
    description: "从当前 BOSS 直聘岗位详情页提取信息，经确认后导入 LinkResume。",
    icons: {
      16: "linkresume-mark.png",
      32: "linkresume-mark.png",
      48: "linkresume-mark.png",
      128: "linkresume-mark.png",
    },
    permissions: ["activeTab"],
    host_permissions: [
      ...bossPermissions,
      ...(isReleaseBuild ? [] : localLinkCVPermissions),
      ...configuredLinkCVPermission(),
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

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

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "LinkCV 岗位采集",
    description: "从当前 BOSS 直聘岗位详情页提取信息，经确认后导入 LinkCV。",
    permissions: ["activeTab"],
    host_permissions: [
      ...bossPermissions,
      ...(process.env.WXT_RELEASE_BUILD === "1" ? [] : localLinkCVPermissions),
      ...configuredLinkCVPermission(),
    ],
    action: {
      default_title: "导入当前岗位到 LinkCV",
    },
  },
});

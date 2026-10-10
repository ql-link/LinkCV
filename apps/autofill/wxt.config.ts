import { defineConfig } from 'wxt';

// 默认的 Jev 接口直接声明；网申页面和自定义接口在用户点击时按站点申请授权。
const jevHosts = ['https://aihubmix.com/*', 'https://openrouter.ai/*'];

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'LinkAutofill 网申填写',
    description: '用本机 JSON 简历自动填写网申表单。只把字段标签发给 Jev 判断，不上传简历内容，不会自动提交。',
    permissions: ['storage', 'scripting', 'activeTab', 'sidePanel'],
    host_permissions: jevHosts,
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: '打开 LinkAutofill' },
  },
});

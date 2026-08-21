# LinkCV 岗位采集插件

这是一个可侧载的 Chrome Manifest V3 插件，只完成一件事：读取用户当前打开的 BOSS 直聘岗位详情，展示可编辑预览，并把确认后的页面字段发送给 LinkCV。它同时支持独立岗位详情页和职位列表页右侧当前选中的详情面板。确定性清洗、来源去重和数据库写入全部由 FastAPI 完成；插件不做岗位分析、匹配、自动投递、批量抓取或后台轮询。

## 本地安装

先在仓库根目录启动 LinkCV，并在 Chrome 中访问 `http://127.0.0.1:5173` 完成登录。然后执行：

```bash
npm run build:extension
```

在 Chrome 打开 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择：

```text
apps/extension/.output/chrome-mv3
```

安装或更新插件后，刷新已经打开的 BOSS 页面。打开形如 `https://www.zhipin.com/job_detail/<id>.html` 的独立详情页，或在 `https://www.zhipin.com/web/geek/jobs` 左侧选择岗位并等待右侧详情加载完成，然后点击插件图标，核对预览并确认导入。列表页导入会从当前选中卡片解析真实岗位详情 URL；无法可靠确认岗位 ID 时会拒绝导入，避免不同岗位共用列表页 URL。

## 开发与验证

```bash
npm run dev:extension
npm run test:extension
npm run typecheck:extension
npm run build:extension
```

插件默认只允许请求本地 `127.0.0.1:5173` 和 `localhost:5173`。需要联调其他 LinkCV Web 源站时，在构建时提供完整源站，不要包含路径：

```bash
WXT_PUBLIC_LINKCV_ORIGIN=https://linkcv.example.com npm run build:extension
```

该值会同时进入运行时 API 候选地址和 Manifest 的精确 `host_permissions`。

## 生成管理员发布包

正式插件包不使用上述本地默认权限。在仓库根目录一次生成 Development 和 Production 两个环境包：

```bash
npm run release:extension -- \
  --development-origin http://127.0.0.1:5173 \
  --production-origin https://linkcv.example.test \
  --output-dir .tmp/plugin-release
```

把示例 Origin 换成用户实际访问的两个 LinkCV 根 Origin。脚本会分别构建、检查 Manifest V3、版本、精确站点权限、ZIP 安全结构和离线说明，并输出两个带环境和版本的 ZIP 以及 `SHA256SUMS`。管理员只向当前环境的 `/admin/plugins` 上传对应 ZIP，不上传源码、校验文件或 `current.json`。

## 权限边界

- `activeTab`：用户点击插件时确认当前活动页。
- `https://*.zhipin.com/*` 的显式站点权限：加载一个只响应插件消息的内容脚本；脚本不会定时采集或自行发请求。
- LinkCV 源站权限：由插件弹窗携带现有 HttpOnly Cookie 调用受保护 API；Cookie、密码和 API Key 都不会被内容脚本读取或保存。

## 开源参考

- [WXT](https://github.com/wxt-dev/wxt)（MIT）：Manifest V3、TypeScript 与 React 的扩展工程基础。
- [Easy-Job-Tutor](https://github.com/yicLionel/Easy-Job-Tutor)（MIT）：参考了其多选择器站点适配和“优先识别详情容器、排除列表卡片”的测试思路；本项目按 LinkCV 数据契约重新实现。
- [job-tracker](https://github.com/Vasco-C-Loureiro/job-tracker)（MIT）：参考“提取—预览—确认保存”的交互流程；未沿用其存储或鉴权实现。

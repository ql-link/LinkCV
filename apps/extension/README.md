# LinkResume 岗位采集插件

这是一个可侧载的 Chrome Manifest V3 插件，只完成一件事：读取用户当前打开的 BOSS 直聘岗位详情，展示可编辑预览，并把确认后的页面字段发送给 LinkResume。它同时支持独立岗位详情页和职位列表页右侧当前选中的详情面板。确定性清洗、来源去重和数据库写入全部由 FastAPI 完成；插件不做岗位分析、匹配、自动投递、批量抓取或后台轮询。

开发版和正式版共用此目录中的一份源码，通过构建参数选择渠道和 LinkResume 地址，不维护两套代码。安装目录、ZIP 和本地源码备份不提交到仓库。

## 本地安装

先在仓库根目录启动 LinkResume，并在 Chrome 中访问 `http://127.0.0.1:5173` 完成登录。然后执行：

```bash
npm run build:extension
```

在 Chrome 打开 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择：

```text
apps/extension/.output/chrome-mv3
```

安装或更新插件后，刷新已经打开的 BOSS 页面。打开形如 `https://www.zhipin.com/job_detail/<id>.html` 的独立详情页，或在 `https://www.zhipin.com/web/geek/jobs` 左侧选择岗位并等待右侧详情加载完成，然后点击插件图标，核对预览并确认导入。列表页导入会从当前选中卡片解析真实岗位详情 URL；无法可靠确认岗位 ID 时会拒绝导入，避免不同岗位共用列表页 URL。

默认展示岗位摘要，薪资与城市、经验、学历同行左对齐，内容过长时换行；描述预览最多六行。右上角“编辑”进入核心字段表单，职位描述输入框高度 144px；“完成编辑”或“返回预览”应用修改，“取消”放弃本轮修改。描述标题右侧“查看全部”展开可滚动的完整原文。

保存成功后点击“查看求职记录”进入本次创建或复用的记录。重复导入同一来源默认复用已有内容，不覆盖已有求职进度；旧服务未返回求职记录时，唯一入口回退为“查看岗位详情”。成功页显示公司图标、岗位摘要和技能标签，图片无法读取时显示公司首字，不展示图片保存成功提示。内容层使用圆角；浏览器自身的原生弹窗外框不受页面 CSS 控制。

日常侧载更新沿用同一个已加载目录：将新构建内容覆盖到该目录，在扩展卡片上点击“重新加载”，再刷新 BOSS 页面；无需卸载重装。新增图片域名权限后，浏览器如提示需要重新启用，按提示启用即可。仅需要分发时才生成 ZIP。

## 开发与验证

本地联调可以使用独立的开发版，并由 WXT 监视源码变更：

```bash
npm run dev:extension:local -- --origin http://127.0.0.1:5175 --port 3002
```

`--origin` 填实际 Web 地址（默认 `http://127.0.0.1:5173`）；`--port` 是 WXT 热更新服务端口（默认 3000），与 Web/API 端口不同。开发版只连接指定本机 Origin，不扫描其他端口，也不回退线上。

WXT 监视构建还会加入本地热更新服务权限以及 `tabs`、`scripting` 调试权限；这些不进入普通正式构建。

首次在 Chrome 加载 `apps/extension/.output/development/chrome-mv3`。需要长期放在其他位置时，追加 `--output-dir /absolute/path/to/development`，加载它下面的 `chrome-mv3`。保持命令运行，WXT 会监视源码并更新开发扩展；必要时刷新 BOSS 页或重开弹窗。停止监视服务后，这种开发构建不适合独立使用，重新启动同一命令即可继续。换 Web 端口后用新的 `--origin` 重启，并按浏览器提示重新加载或启用扩展。

开发版与正式版使用不同目录，可同时安装。正式版继续连接线上，更新时覆盖其固定目录并点击“重新加载”，不需要卸载重装；Chrome 扩展管理页顶部的“更新”主要用于有更新源的扩展，不负责重新构建本地侧载目录。

```bash
npm run dev:extension
npm run test:extension
npm run typecheck:extension
npm run build:extension
```

普通本地开发构建在 Manifest 中标记为“开发版”，默认只允许请求本地 `127.0.0.1:5173` 和 `localhost:5173`。需要联调其他 LinkResume Web 源站时，在构建时提供完整源站，不要包含路径：

```bash
WXT_PUBLIC_LINKRESUME_ORIGIN=https://linkresume.example.com npm run build:extension
```

该值会同时进入运行时 API 候选地址和 Manifest 的精确 `host_permissions`。

## 生成管理员发布包

正式插件包不使用上述本地默认权限。在仓库根目录一次生成 Development 和 Production 两个环境包：

```bash
npm run release:extension -- \
  --development-origin http://127.0.0.1:5173 \
  --production-origin https://linkresume.example.test \
  --output-dir ../../.tmp/plugin-release
```

把示例 Origin 换成用户实际访问的两个 LinkResume 根 Origin。脚本会为两个包分别注入渠道和唯一 LinkResume Origin：Development 包名称带“开发版”，只连接开发 Origin；Production 包使用正式名称，只连接生产 Origin。脚本同时检查 Manifest V3、版本、环境名称、精确站点权限和 ZIP 安全结构，并输出两个带环境和版本的 ZIP 以及 `SHA256SUMS`。管理员只向当前环境的 `/admin/plugins` 上传对应 ZIP，不上传源码、校验文件或 `current.json`。管理端上传不再根据 Origin 拒绝安装包，因此发布者仍需自行选择与当前环境匹配的构建产物。

## 权限边界

- `activeTab`：用户点击插件时确认当前活动页。
- `https://*.zhipin.com/*` 的显式站点权限：加载一个只响应插件消息的内容脚本；脚本不会定时采集或自行发请求。
- `https://img.bosszhipin.com/*`、`https://img2.bosszhipin.com/*`：弹窗下载当前公司的 Logo，不携带 BOSS Cookie；图片在岗位保存后单独上传，失败不会撤销岗位导入。
- LinkResume 源站权限：由插件弹窗携带现有 HttpOnly Cookie 调用受保护 API；Cookie、密码和 API Key 都不会被内容脚本读取或保存。

## 开源参考

- [WXT](https://github.com/wxt-dev/wxt)（MIT）：Manifest V3、TypeScript 与 React 的扩展工程基础。
- [Easy-Job-Tutor](https://github.com/yicLionel/Easy-Job-Tutor)（MIT）：参考了其多选择器站点适配和“优先识别详情容器、排除列表卡片”的测试思路；本项目按 LinkResume 数据契约重新实现。
- [job-tracker](https://github.com/Vasco-C-Loureiro/job-tracker)（MIT）：参考“提取—预览—确认保存”的交互流程；未沿用其存储或鉴权实现。

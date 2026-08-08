# 浏览器岗位采集插件

## 职责与边界

`apps/extension` 是 WXT + React + TypeScript 的 Chrome Manifest V3 插件。它只处理用户主动打开的 BOSS 直聘岗位详情：既支持独立岗位详情页，也支持职位列表页右侧当前选中的详情面板。用户点击插件后，内容脚本读取当前 DOM，弹窗展示可编辑预览，确认后由弹窗调用 `POST /api/job-descriptions/import`。

插件不做岗位分析、简历匹配、自动投递、批量抓取、后台轮询或反爬绕过。页面采集字段只保存在当前弹窗内存中；插件不使用 `storage` 权限，不保存 Cookie、密码、API Key 或原始页面。后端执行确定性清洗、来源规范化、去重和最终结构化入库，原始抓取内容不落库。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| `wxt.config.ts` | MV3 Manifest、BOSS 与 LinkCV 精确站点权限 |
| `entrypoints/boss.content.ts` | 只响应弹窗消息的 BOSS 内容脚本 |
| `src/extractor/boss.ts` | 多选择器详情识别、列表卡片排除和页面字段提取 |
| `entrypoints/popup/` | 登录状态、可编辑预览、提交、重复来源和结果反馈 |
| `src/api/linkcv.ts` | 本地 LinkCV 源站探测、Cookie 会话刷新和导入客户端 |

内容脚本和 API 客户端分开：BOSS 页面上下文只返回采集字段，带 LinkCV `host_permissions` 的扩展弹窗才发送受保护 API 请求。普通开发构建保留 `127.0.0.1:5173` 和 `localhost:5173` 候选，并优先选择已有登录态的源站。正式发布构建设置 `WXT_RELEASE_BUILD=1`，此时移除本地默认权限，只保留 `WXT_PUBLIC_LINKCV_ORIGIN` 指定的一个精确 LinkCV Origin 与受控 BOSS Origin。

## 提取与失败策略

采集器首先校验 `zhipin.com` 的 `/job_detail/<id>.html` 或 `/web/geek/jobs` URL。独立详情页直接读取岗位头部、公司侧栏和职位详情容器；列表页先按语义和容器可信度定位右侧详情面板，再通过右侧详情链接、当前选中卡片或可信岗位 ID 属性解析真实 `/job_detail/<id>.html` 来源。无法可靠获得岗位 ID 时拒绝导入，不能把所有岗位共用的列表页 URL 用于来源去重。正文候选按选择器可信度、语义标记和文本长度打分，并排除推荐列表、搜索列表和岗位卡片祖先。经验字段只接受经验语义格式；`5天/周`、`6个月` 等实习安排单独进入 `work_schedule`，福利标签不会混入技能。岗位名、公司名或正文任一缺失时拒绝提交并提示刷新页面；可选字段缺失只在预览中警告。

BOSS DOM 不是稳定公共契约。站点结构变化时优先新增最窄的选择器和对应 HTML fixture 测试，不能退化为读取整个 `document.body`，也不能把推荐岗位列表混入当前岗位正文。

## 构建和人工验证

安装、侧载和环境构建命令见 [`apps/extension/README.md`](../../apps/extension/README.md)。自动化测试覆盖 DOM 详情选择、必填失败、登录源站选择和 access 过期刷新；真实 BOSS 页面、真实 Chrome Cookie 与 FastAPI/MySQL 的完整链路仍需人工验收。

面向管理员发布的安装包通过根目录脚本一次生成 Development 与 Production 两个 ZIP：

```bash
uv run --directory apps/backend python ../../scripts/release/build_extension_release.py \
  --development-origin http://127.0.0.1:5173 \
  --production-origin https://linkcv.example.test \
  --output-dir ../../.tmp/plugin-release
```

脚本以 `apps/extension/package.json.version` 为版本真值，分别注入精确 Origin，运行 WXT ZIP 构建，并检查 Manifest V3、三段数字版本、精确 `host_permissions`、压缩包路径与大小，以及根目录的 `安装与使用说明.html`。输出包含两个确定命名的 ZIP 和 `SHA256SUMS`；管理员只把与当前环境匹配的 ZIP 上传到管理台。

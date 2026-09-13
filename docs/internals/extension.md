# 浏览器岗位采集插件

## 职责与边界

`apps/extension` 是以 LinkResume 为用户可见品牌的 WXT + React + TypeScript Chrome Manifest V3 插件。它只处理用户主动打开的 BOSS 直聘岗位详情：既支持独立岗位详情页，也支持职位列表页右侧当前选中的详情面板。用户点击插件后，内容脚本读取当前 DOM，弹窗展示可编辑预览，确认后由弹窗调用 `POST /api/job-descriptions/import`。弹窗沿用 Web 的白色表面、近黑主操作与蓝色文本入口，固定宽度 420px。预览、编辑和完整描述页高度 600px；成功页由岗位摘要和技能标签撑高，内容较多时允许增长至 600px 并滚动。默认预览岗位摘要、公司图标、薪资、城市、经验、学历和技能；“编辑”位于岗位信息右上方，“查看全部”位于描述标题右侧，两者右对齐。编辑页只展示岗位、公司、薪资、城市和描述，其他采集字段继续随请求提交；“完成编辑”和“返回预览”校验并应用修改，“取消”丢弃本轮修改。完整描述仅滚动正文，顶部收起入口和底部保存按钮固定。只对原文中明确的段落标题增加层级，不生成或改写岗位正文。采集时可选字段缺失不额外提示，保存失败才展示可恢复错误。登录与旧服务重复来源分支保留必要操作。插件保持独立构建，不直接依赖 Web 组件包。

插件不做岗位分析、简历匹配、自动投递、批量抓取、后台轮询或反爬绕过。页面采集字段只保存在当前弹窗内存中；插件不使用 `storage` 权限，不保存 Cookie、密码、API Key 或原始页面。后端执行确定性清洗、来源规范化、去重和最终结构化入库，原始抓取内容不落库。当前后端导入会创建或复用岗位及求职记录；来源重复默认复用已有内容。插件成功页保留公司图标、岗位摘要和一个主入口：优先打开响应 `application.id` 对应的求职记录；兼容旧服务缺少或返回空 `application` 时，标题为“岗位已保存”，主入口回退为岗位详情。成功页不显示返回预览、额外跳转或图标保存成功提示。旧服务返回重复来源冲突时仍保留用本次内容更新、打开已有 JD 和返回预览操作。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| `wxt.config.ts` | MV3 Manifest、BOSS 与 LinkResume 精确站点权限 |
| `entrypoints/boss.content.ts` | 只响应弹窗消息的 BOSS 内容脚本 |
| `src/extractor/boss.ts` | 多选择器详情识别、列表卡片排除和页面字段提取 |
| `entrypoints/popup/` | 登录状态、可编辑预览、提交、重复来源和结果反馈 |
| `src/api/linkresume.ts` | 本地 LinkResume 源站探测、Cookie 会话刷新和导入客户端 |

内容脚本和 API 客户端分开：BOSS 页面上下文只返回采集字段，带 LinkResume `host_permissions` 的扩展弹窗才发送受保护 API 请求。普通本地构建使用“LinkResume 岗位采集（开发版）”名称，保留 `127.0.0.1:5173` 和 `localhost:5173` 候选，并优先选择已有登录态的源站。发布脚本设置 `WXT_RELEASE_BUILD=1`，并分别注入 `development` 或 `production` 渠道及唯一 `WXT_PUBLIC_LINKRESUME_ORIGIN`；发布包运行时不回退到其他环境，Manifest 也只包含对应 LinkResume Origin 与受控 BOSS Origin。Development 包保留“开发版”名称，Production 包使用“LinkResume 岗位采集”。

## 提取与失败策略

采集器首先校验 `zhipin.com` 的 `/job_detail/<id>.html` 或 `/web/geek/jobs` URL。独立详情页直接读取岗位头部、公司侧栏和职位详情容器；列表页先按语义和容器可信度定位右侧详情面板，再通过右侧详情链接、当前选中卡片或可信岗位 ID 属性解析真实 `/job_detail/<id>.html` 来源。无法可靠获得岗位 ID 时拒绝导入，不能把所有岗位共用的列表页 URL 用于来源去重。正文候选按选择器可信度、语义标记和文本长度打分，并排除推荐列表、搜索列表和岗位卡片祖先。经验字段只接受经验语义格式；`5天/周`、`6个月` 等实习安排单独进入 `work_schedule`，福利标签不会混入技能。公司 Logo 优先从详情区域提取，缺失时只回退到已确认来源 ID 的当前岗位卡片；支持公司 Logo 容器、公司主页链接内的图片、`data-src`/`data-original`/`data-lazy-src`、浏览器 `currentSrc` 及 `srcset`。忽略推荐岗位、招聘者头像和非 HTTPS 图片，将有效地址作为可选 `logo_url` 保留在采集数据中，不提供 URL 输入框。预览通过受限下载生成临时 Blob URL 显示图标；图片缺失或解码失败使用公司首字，关闭弹窗释放 Blob URL。岗位导入成功后，弹窗仅从 `img.bosszhipin.com`、`img2.bosszhipin.com` 下载公司图片（HTTPS、不携带 Cookie、不跟随重定向、8 秒超时、2 MiB 上限），通过独立 Logo 接口上传后端托管。默认跳过已有托管图片；下载或上传失败在成功页提示图标未保存，岗位仍保持已导入，可再次采集补图。内容脚本只提取信息，不承担跨域下载。岗位名、公司名或正文任一缺失时拒绝提交并提示刷新页面；可选字段缺失不阻止保存，也不显示常驻提醒。

BOSS DOM 不是稳定公共契约。站点结构变化时优先新增最窄的选择器和对应 HTML fixture 测试，不能退化为读取整个 `document.body`，也不能把推荐岗位列表混入当前岗位正文。

## 构建和人工验证

本地源码监视入口是 `npm run dev:extension:local -- --origin http://127.0.0.1:5175 --port 3002`。它将 API 与 Manifest 同时绑定到指定的回环 HTTP Origin，使用 WXT 热更新，并默认输出到独立的 `.output/development/chrome-mv3`；`--output-dir` 可指定长期侧载目录的父目录。开发版与正式版使用不同目录并存，监视服务需保持运行。端口变化后用新 Origin 重启开发命令，不自动探测其他应用或生产环境。正式版仍通过覆盖原目录和扩展卡片“重新加载”更新。

安装、侧载和环境构建命令见 [`apps/extension/README.md`](../../apps/extension/README.md)。自动化测试覆盖 DOM 详情选择、必填失败、登录源站选择、access 过期刷新和重复来源更新动作；真实 BOSS 页面、真实 Chrome Cookie 与 FastAPI/MySQL 的完整链路仍需人工验收。

面向管理员发布的安装包通过根目录脚本一次生成 Development 与 Production 两个 ZIP：

```bash
uv run --directory apps/backend python ../../scripts/release/build_extension_release.py \
  --development-origin http://127.0.0.1:5173 \
  --production-origin https://linkresume.example.test \
  --output-dir ../../.tmp/plugin-release
```

脚本以 `apps/extension/package.json.version` 为版本真值，分别注入渠道和精确 Origin，运行 WXT ZIP 构建，并检查 Manifest V3、三段数字版本、环境名称、精确 `host_permissions`、压缩包路径与大小。输出包含两个确定命名的 ZIP 和 `SHA256SUMS`；管理员只把与当前环境匹配的 ZIP 上传到管理台。上传接口不根据 Origin 或端口判断环境，环境包的选择由发布者负责。

BOSS 采集将实习、校招/校园招聘/应届、正式/社招/全职的标签和岗位名线索一并传入 `employment_type_text`，后端统一映射为实习、校招、正式三类；兼职、合同、临时仍不当作技能采集，无法分类时保存空值。

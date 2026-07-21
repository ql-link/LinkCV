# LinkCV

LinkCV 正在从 React + Express 原型迁移为 React/TypeScript + FastAPI 前后端分离 Monorepo。

本文是项目使用与开发入口，只保留所有任务都需要知道的仓库事实、真实命令和长期约束。当前模块知识见 [docs/README.md](docs/README.md)，详细交付流程见 [.ai/skills/README.md](.ai/skills/README.md)，Spec 状态规则见 [.specs/README.md](.specs/README.md)。`AGENTS.md` 与 `CLAUDE.md` 统一链接到本文件。

## 1. 沟通与决策

- 默认使用中文沟通、总结和撰写 PR 说明；代码、命令、日志与技术标识保留原文。
- 先核实仓库事实再给结论。不要为了迎合用户跳过风险、证据或尚未确认的假设。
- 不过分夸赞。用户和 Agent 的判断都可能有误；出现矛盾时优先补证据和说明取舍。
- 只在缺少的选择会实质改变结果时提问；低风险细节可采用明确写出的合理假设。

## 2. 仓库结构与架构边界

```text
apps/web       React 19、TypeScript、Vite 前端
apps/backend   Python 3.13、FastAPI 后端
server         临时 Express API
deploy         Compose 与部署资料
docs           供开发者和 AI 按需调阅的长期项目知识
.ai            项目规则与交付 Skill 的唯一来源
.specs         L2/L3 任务的本地阶段快照；产物模板跟随对应项目技能保存
scripts        初始化、质量与阶段门禁脚本
```

- 当前处于 Express 向 FastAPI 迁移期。`/api/health` 走 FastAPI，其他 `/api` 请求暂时走 Express。
- 未完成实现和回归验证前，不得切换现有路由，也不得删除 `server`、SQLite 或旧部署拓扑。
- FastAPI、前端 API client、Vite Proxy、环境变量和部署配置属于同一跨端契约；修改其中一处时检查其他位置。
- 鉴权、数据库、对象存储、资源归属和数据完整性改动一律按高风险跨模块改动处理。

## 3. 初始化与验证命令

```bash
npm run setup       # 新环境安装依赖并修复缺失的安全链接
npm run dev         # 启动 Web、FastAPI 和临时 Express
npm run check:ai    # 校验 AI 链接和项目 Skill
npm run check:docs  # 校验长期文档及代码到文档同步关系
npm run check:contracts # 校验确定性的运行时契约值
npm test            # 运行前端和后端自动化测试
npm run check:app   # 前后端测试、类型检查和构建
npm run check       # 完整本地质量入口
npm run spec -- ... # 管理 L2/L3 本地阶段状态
```

- Python 命令统一通过 `uv run --directory apps/backend` 执行，不依赖系统 `python`。
- 不得宣称测试通过，除非实际运行了与改动范围匹配的命令并看到了成功结果。
- 前端使用 Vitest + React Testing Library，后端使用 pytest；跨端 E2E 当前采用人工验证。不得把 Gherkin 场景、组件测试或后端接口测试描述成已完成自动化端到端验收。

## 4. 交付流程入口

- 任何改代码请求先由 `flow-router` 按真实影响面判定 L1/L2/L3，详细判据和阶段转交以对应 Skill 为准。
- 需求或技术设计存在真实决策分支时使用 `decision-grilling`：能从仓库核实的事实由 Agent 自行调查；需要用户取舍的决策按依赖顺序每轮只询问一个，并提供推荐答案和影响分析。
- L1 直接实现和验证；L2 需要冻结 Brief 与 Acceptance；L3 还需要冻结 Technical Design。
- 设计 MySQL 表结构时使用 `mysql-ddl-conventions`；编写、校验或排查 SQLAlchemy/Alembic 迁移时使用 `alembic-migration`。数据库改动始终属于 L3，但两个数据库技能只在命中时按需调用，不固定串入无关任务。
- 用户要求判断“功能是否真正做完、还缺什么”时使用 `feature-completion-audit`；当前会话刚完成的实现必须由独立子 Agent 取证，避免实现者自评。
- 用户要求根据报错、日志或异常现象查原因时使用 `incident-triage`，默认只诊断；没有修复授权时不修改代码、配置、外部系统或数据。
- Multica Issue 是长期需求、范围和验收标准的主记录。不要自动创建、修改、评论或关闭 Multica/GitHub 对象。
- `.specs/<LCV-key>/` 是本地执行快照，不是第二份长期需求库。冻结产物后由 `state.yaml` 记录哈希；内容变化必须重新冻结。适用的人工端到端结果记录在同目录 `manual_acceptance.md`，PR 只摘要结论。
- L2/L3 开始实现前运行阶段检查；L1 不强制创建 `.specs`。只在任务触发时读取对应 Skill。
- 搭建或修订这套 AI 工作流框架本身时允许采用自举例外，不要求先用尚未稳定的流程生成 Spec；框架用于正式业务开发后，再按上述车道强制执行。自举例外不免除真实代码核实、测试和审查。

## 5. 实现约束

- 改动前先读取最接近目标文件的现有实现、测试和文档，不凭框架惯例猜测项目结构。
- 保持改动聚焦；不顺带重构无关模块，不覆盖用户已有修改。
- API、持久化模型、迁移、权限和失败路径必须同步设计与验证。
- 当前 FastAPI 尚未建立 SQLAlchemy/Alembic 基线。首次引入持久化时必须同时建立模型真值源、迁移链、测试入口、文档同步和部署回滚；原型 SQLite 数据默认不迁移到 MySQL。
- `docs/` 只描述当前已实现的长期项目事实；Brief、Acceptance、Technical Design、实施报告和人工验收记录继续放在 `.specs/<KEY>/`。
- Express 迁移到 FastAPI 时，明确旧路由、兼容窗口、Vite Proxy、回滚方式和数据处理策略。
- 新依赖必须说明必要性，并更新对应 lockfile。
- 默认示例和测试数据使用虚构信息，不得写入用户真实简历、联系方式或密钥。

## 6. Git 与 PR

- 禁止直接向远端 `dev`、`master`、`main` 推送、合并或改写历史。
- 创建分支、提交、推送或 PR 时必须使用 `branch-pr-workflow`；分支命名、规范化中文提交和中文 PR 模板只在该 Skill 中维护，不在本入口重复。
- 默认使用独立类型分支并创建以 `dev` 为 base 的 PR；发布前确认 base/head、完整 diff 和验证结果，不带入无关改动。
- PR 创建后交由用户或远端审核，不代替用户合并，除非用户再次明确授权。

## 7. 完成定义

- 实现与确认的范围一致，未解决的偏差已明确记录。
- 新增或修改行为有与当前测试基础相匹配的验证。
- `npm run check` 通过；若环境阻塞，准确报告未执行项和原因。
- 受影响的 API、配置、部署和文档同步完成。
- 没有真实用户数据、凭据、构建产物或无关文件进入提交。

## 8. 原型与简历产品约束

- 可自行运行本地服务时，由 Agent 启动并打开预览，不把启动步骤转交给用户。
- 大幅视觉修改前，如果视觉来源不清楚或与当前目标不一致，先获取产品设计上下文。
- 从选定效果图实现时，以效果图的布局、组件结构、密度、间距、色彩、字体、可见内容和层级为准。
- 用户给出可长期复用的原型设计反馈、偏好或决策时，更新本文。
- 默认简历模板使用虚构示例内容，当前姓名为“张三”，不得包含用户真实简历或联系方式。
- 默认简历使用精致的中文衬线字体栈，不使用已移除的 Google CJK serif 字体族。
- 暴露在 UI 中的霞鹜文楷等可选字体必须作为 Web Font 打包，不能依赖系统安装。
- 左右结构的简历行不得自动加粗左侧内容；只有 `**text**` 等显式 Markdown 强调才加粗。
- Markdown 标题不自动加粗；默认通过字号、间距和分隔线建立层级。
- 显式 Markdown 粗体必须在网页预览和 PDF 中清晰可见；中文衬线字体需要时允许合成粗体。
- 显式粗体使用中等字重和略浅于正文的墨色，保持清晰但不过重。

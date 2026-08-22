# LinkCV

LinkCV 是 React/TypeScript + FastAPI 前后端分离 Monorepo。本文只保存所有任务都需要的入口、命令和底线；具体模块事实从 `docs/README.md` 查找，交付流程见 `.ai/skills/README.md`，本地 Spec 规则见 `.specs/README.md`。`AGENTS.md` 与 `CLAUDE.md` 都链接到本文件，只修改这一份源文件。

## 1. 通用原则

- 默认使用中文沟通、总结和撰写 PR 说明；代码、命令和技术标识保留原文。
- 不过分夸赞；先核实代码、配置和测试再给结论，不为迎合用户省略风险或不确定点。
- 只在缺少的选择会实质改变结果时提问；低风险细节可以采用并说明合理假设。
- 修改前保护用户已有改动，保持范围聚焦，不顺带重构无关内容。

## 2. 仓库与知识入口

```text
apps/web       React、TypeScript、Vite 前端
apps/extension WXT 浏览器岗位采集插件
apps/backend   Python、FastAPI 后端
deploy         Compose 与部署资料
docs           当前已实现的长期项目知识
.ai            项目入口和交付 Skill
.specs         方案先行任务的本地文档
scripts        初始化、质量、契约和开发脚本
```

- 修改具体模块前，按 `docs/README.md` 读取对应文档，不把本入口扩成模块知识库。
- 开发期全部 `/api` 请求由 Vite 代理到 FastAPI；仓库中不再有 Express 运行入口。
- FastAPI、前端 API client、Vite Proxy、环境变量和部署配置属于同一跨端契约，修改一处时检查其他消费方。
- 后端使用 MySQL 和 SQL-first Alembic，根 revision `0001` 已建立；仓库 head 和迁移约定从 `docs/internals/backend.md` 查找，目标环境 current 必须查询真实环境。测试中的 SQLite 和假 MinIO 只是替身。
- 鉴权、数据库、对象存储、资源归属、数据完整性和破坏性操作需要严格核对权限、失败结果、回退或不可逆影响。

## 3. 常用命令与验证

```bash
npm run setup           # 初始化环境
npm run dev:local       # 本地代码 + 本地中间件（.env + .env.local）
npm run dev:development # 本地代码 + 共享 Dev 中间件（.env.development + .env.development.local）
npm run check:ai        # 校验 AI 入口和 Skill
npm run check:docs      # 校验长期文档同步
npm run check:contracts # 校验确定性运行时契约
npm test                # 运行三个应用的自动化测试
npm run check:app       # 测试、类型检查和构建三个应用
npm run check           # 完整本地质量入口
```

- 启动或重启开发服务时必须按用户要连接的中间件显式选择 profile：“全部本地”使用 `npm run dev:local`，“本地项目使用共享 Dev 中间件”使用 `npm run dev:development`。`npm run dev` 只是 `dev:local` 的兼容别名，不作为未说明目标时的默认选择。
- `APP_ENV` 控制应用功能，不负责选择 env 文件；不得根据 `APP_ENV=development` 推断进程已加载 `.env.development`。以启动器打印的“基础配置”和“共享私密覆盖”路径为准，启动后再核对 5173 Web、8000 FastAPI 和目标中间件的实际连通性。
- Python 命令统一通过 `uv run --directory apps/backend` 执行，不依赖系统 `python`。
- 当前任务运行与改动范围和风险匹配的检查；创建 PR 前，对当前可提交内容运行完整 `npm run check`。
- 只报告亲自运行并看到结果的测试、构建、迁移或部署命令；环境阻塞和未执行项要如实说明。
- 当前没有自动化跨端 E2E。Gherkin、组件测试和后端接口测试不能描述成已完成自动化端到端验收。

## 4. 交付路径

- 用户未指定交付方式时，改代码请求先由 `flow-router` 判断准备程度、复杂度、风险和记录需要；详细算法只在对应 Skill 维护。
- 用户当前请求、可读取的 Issue、飞书文档或其他指定材料都可作为需求来源；没有 Issue 不阻止开工。

```text
工作流：自动 | 开启 | 关闭
路径：自动 | 直接实现 | 方案先行
后续：自动 | 直接施工 | 契约验收
```

- 等价的自然语言同样有效。`自动` 由 `flow-router` 判断；`开启` 使用用户已选路径，未选时仍由它判断；`后续：自动` 在确认方案时一并确定。`关闭` 直接执行。
- 用户更具体、更新的选择优先并立即生效；仍无法消解冲突时优先关闭工作流。自动判断不得静默覆盖用户选择或反复确认，最多简短提示一次真实风险。
- `直接实现` 不创建 Spec；`方案先行` 先确认 `solution.md`；只有选择契约验收时才增加 `acceptance.feature`。三条路径因此是：直接实现、方案后实现、方案与验收契约后实现。
- `.specs/<KEY>/` 以 `solution.md` 为中心，不保存阶段状态、哈希或历史测试标记。开始或恢复任务时重新读取当前请求、Spec、Git 差异和真实代码；跨会话不继承旧测试结论。
- 需求和交付信息按单向链路流转：上游材料不反向同步，PR 说明实际交付与重要差异，存在来源 Issue 时在 PR 创建后只补一条交付评论；详细边界见 `.ai/skills/README.md`。
- `工作流：关闭` 只跳过项目交付文档和分流，不跳过真实代码核实、必要验证、安全底线或 Git 授权边界。
- 工作流框架自身的改造可以自举，不要求先用尚未稳定的流程生成 Spec，但仍须核实、测试和审查。

## 5. 实现与安全底线

- 先读离目标最近的实现、测试和文档；API、持久化模型、迁移、权限、失败路径和消费方要同步考虑。
- 数据库 schema 使用 SQL-first Alembic；ORM 与升级到 head 后的 schema 保持一致，每个 revision 配对并验证 `.up.sql`、`.down.sql`。具体设计和迁移分别读取 `mysql-ddl-conventions`、`alembic-migration`。
- `docs/` 只描述已经实现的长期事实；方案、Acceptance、实施报告和人工验收记录放在 `.specs/<KEY>/`。
- 新依赖必须说明必要性并更新对应 lockfile。
- 示例和测试使用虚构信息，不得写入真实简历、联系方式、账号、密钥或私有部署凭据。
- `/` 与 `/home` 无论登录状态都保持展示公共落地页，不能自动跳转到工作台；未登录 CTA 进入 `/login`，已登录 CTA 进入 `/resumes`。
- 可能造成数据丢失、越权、凭据泄露，或目标与作用范围仍不明确时，停止执行并说明具体阻塞。

## 6. Git 与完成定义

- 禁止改写远端 `release`、`dev`、`main`、`master` 历史，默认也禁止直接推送或合并。只有用户明确要求绕过 PR、直接推送并点名目标共享分支时，才可例外直推；执行前仍须复述目标和影响范围，不能据此代替用户执行远端合并。
- 创建分支、提交、推送或 PR 时使用 `branch-pr-workflow`。新的业务需求分支必须从最新 `origin/master` 创建；修改完成后先由业务分支向 `release` 提 PR，`release` 合并并测试通过后，再由同一业务分支向 `master` 提 PR。不得默认以 `dev` 为目标，也不得用 `release -> master` PR 代替业务分支回合 `master`；每一步都要核对 base/head、提交范围、完整 diff 和真实验证结果。
- PR 创建后交由用户或远端审核；没有新的明确授权，不代替用户合并。
- 完成时范围应与确认结论一致，与范围和风险匹配的检查须通过，受影响的契约、配置、部署和文档已同步。检查失败或环境阻塞时如实说明，不得宣称通过或完整完成。
- 提交中不得包含真实用户数据、凭据、构建产物或无关文件。

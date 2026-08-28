# 契约面与事实源映射

机器可确定的同步关系位于 `scripts/quality/doc-sync-rules.yaml` 和 `scripts/quality/runtime-contract-rules.yaml`。

| 契约面 | 代码或配置事实源 | 主要消费方 | 长期文档 |
| --- | --- | --- | --- |
| HTTP 路由与 schema | `apps/backend/src/linkcv/api/`、`apps/backend/src/linkcv/modules/` | Web API client、Vite 代理 | `docs/api/http-contracts.md`；业务归属见 `docs/features/`，运行结构见 `docs/internals/` |
| 浏览器导入请求 | `apps/backend/src/linkcv/modules/job_descriptions/schemas.py`、`apps/extension/src/contracts.ts` | 插件 API client、后端导入清洗 | `docs/api/http-contracts.md`、`docs/internals/extension.md` |
| 开发期路由归属 | `apps/web/vite.config.mjs` | FastAPI、根级启动命令 | `docs/internals/architecture.md`、`docs/ops/development.md` |
| 鉴权与资源归属 | `modules/identity/`、`core/security.py` | Web、小程序、MySQL、Redis | `docs/features/identity-account.md`、`docs/internals/miniprogram.md`、`docs/api/http-contracts.md` |
| 简历持久化 | `modules/resumes/models.py`、`migrations/` | Web store、小程序、求职进程、Agent | `docs/features/resume-workbench.md`、`docs/internals/backend.md`、`docs/api/http-contracts.md` |
| 简历智能助手 | `modules/agent/`、`modules/llm/`、`apps/pi-service/`、`third_party/pi/` | Web Agent 面板、管理员模型页、Compose/Jenkins | `docs/features/ai-assistant.md`、`docs/internals/agent-runtime.md`、`docs/api/http-contracts.md`、`docs/ops/deployment.md` |
| 图片对象存储 | `core/storage.py`、`modules/resumes/asset_routes.py` | Web 上传与预览、MinIO | `docs/internals/backend.md`、`docs/api/http-contracts.md` |
| 简历文件导入 | `modules/resumes/import_routes.py`、`overview_routes.py`、`core/mq/`、`workers/`、`resume_import_idempotency.py` | Web API client、MySQL、Redis、RabbitMQ/Kafka、统一 LLM、MinIO | `docs/api/http-contracts.md`、`docs/internals/backend.md`、`docs/ops/development.md` |
| 求职中心 | `modules/job_descriptions/`、`modules/interviews/` | Web 岗位/面试页、浏览器插件、Agent 上下文 | `docs/features/career-center.md`、`docs/api/http-contracts.md` |
| 用户资料集 | `modules/datasets/`、`modules/resumes/models.py`、`services/dataset_upload_service.py`、`core/mq/`、`workers/`、迁移 `0043` | Web 资料集页、Agent 工具、MySQL、MinIO、RabbitMQ、LinkParse | `docs/features/datasets.md`、`docs/api/http-contracts.md`、`docs/internals/backend.md`、`docs/internals/web.md`、`docs/ops/development.md`、`docs/ops/deployment.md` |
| 小程序渠道 | `apps/miniprogram/`、`modules/miniprogram/` | 账号、简历、PDF/PNG 渲染 | `docs/internals/miniprogram.md`、`docs/api/http-contracts.md`、`docs/ops/development.md` |
| 系统日志与业务审计 | `modules/observability/`、Web API client、Promtail Compose | 管理端日志中心、共享 Loki | `docs/internals/observability.md`、`docs/api/http-contracts.md`、`docs/ops/deployment.md` |
| 插件发布与下载 | `modules/plugin_releases/`、`core/storage.py` | 岗位库安装入口、管理台、MinIO、浏览器插件构建 | `docs/internals/plugin-delivery.md`、`docs/api/http-contracts.md`、`docs/internals/extension.md` |
| 本地环境变量 | `.env.example`、根级 `package.json`、Vite、Compose | 开发者与本地进程 | `docs/ops/development.md` |
| 构建与部署 | `Jenkinsfile`、`Dockerfile`、`deploy/`、GitHub Actions | CI、部署主机 | `docs/ops/deployment.md` |
| AI 交付流程 | `.ai/skills/`、`.specs/`、`scripts/quality/` | 开发 Agent、CI | `.ai/skills/README.md`、`.specs/README.md` |

代码行为以真实实现和测试为准；具体需求的计划、取舍和实施记录留在 `.specs/<KEY>/`。

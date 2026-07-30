# 契约面与事实源映射

机器可确定的同步关系位于 `scripts/quality/doc-sync-rules.yaml` 和 `scripts/quality/runtime-contract-rules.yaml`。

| 契约面 | 代码或配置事实源 | 主要消费方 | 长期文档 |
| --- | --- | --- | --- |
| HTTP 路由与 schema | `apps/backend/src/linkcv/api/`、`apps/backend/src/linkcv/modules/` | Web API client、Vite 代理 | `docs/api/http-contracts.md` |
| 浏览器导入请求 | `apps/backend/src/linkcv/modules/job_descriptions/schemas.py`、`apps/extension/src/contracts.ts` | 插件 API client、后端导入清洗 | `docs/api/http-contracts.md`、`docs/internals/extension.md` |
| 开发期路由归属 | `apps/web/vite.config.mjs` | FastAPI、根级启动命令 | `docs/internals/architecture.md`、`docs/ops/development.md` |
| 鉴权与资源归属 | `modules/identity/`、`core/security.py` | Web API client、MySQL | `docs/api/http-contracts.md`、`docs/internals/backend.md` |
| 简历持久化 | `modules/resumes/models.py`、`migrations/` | Web store 与 API client | `docs/internals/backend.md`、`docs/api/http-contracts.md` |
| 图片对象存储 | `core/storage.py`、`modules/resumes/asset_routes.py` | Web 上传与预览、MinIO | `docs/internals/backend.md`、`docs/api/http-contracts.md` |
| 简历文件导入 | `integrations/document_converter.py`、`linkparse_client.py`、`resume_import_idempotency.py` | Web API client、Redis、统一 LLM、MinIO | `docs/api/http-contracts.md`、`docs/internals/backend.md`、`docs/ops/development.md` |
| 本地环境变量 | `.env.example`、根级 `package.json`、Vite、Compose | 开发者与本地进程 | `docs/ops/development.md` |
| 构建与部署 | `Jenkinsfile`、`Dockerfile`、`deploy/`、GitHub Actions | CI、部署主机 | `docs/ops/deployment.md` |
| AI 交付流程 | `.ai/skills/`、`.specs/`、`scripts/quality/`、`scripts/spec/` | 开发 Agent、CI | `.ai/skills/README.md`、`.specs/README.md` |

代码行为以真实实现和测试为准；具体需求的计划、取舍和实施记录留在 `.specs/<KEY>/`。

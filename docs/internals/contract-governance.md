# 契约面与事实源映射

本文记录 LinkCV 各类稳定契约的代码事实源、主要消费方和长期文档位置。开发者和 AI 修改一个契约面时，只读取命中的模块，不需要扫描全部项目文档。

机器可确定判断的同步关系位于 `scripts/quality/doc-sync-rules.yaml` 和 `scripts/quality/runtime-contract-rules.yaml`；本文解释模块关系，不复制机器规则。

| 契约面 | 代码或配置事实源 | 主要消费方 | 长期文档 |
| --- | --- | --- | --- |
| HTTP 路由与 schema | `apps/backend/src/linkcv/api/`、`server/index.mjs` | `apps/web/src/api/client.ts`、Vite 代理 | `docs/api/http-contracts.md` |
| 开发期路由归属 | `apps/web/vite.config.mjs` | FastAPI、Express、根级启动命令 | `docs/internals/architecture.md`、`docs/ops/development.md` |
| 鉴权与资源归属 | `server/auth.mjs`、`server/index.mjs` | Web API client、SQLite 数据 | `docs/api/http-contracts.md`、`docs/internals/legacy-express.md` |
| 简历持久化 | `server/db.mjs`、`server/index.mjs` | Web store 与 API client | `docs/internals/legacy-express.md`、`docs/api/http-contracts.md` |
| 图片对象存储 | `server/minio.mjs`、`server/index.mjs` | Web 上传与预览 | `docs/internals/legacy-express.md`、`docs/api/http-contracts.md` |
| 本地环境变量 | `.env.example`、根级 `package.json`、Vite、Compose | 开发者与三个本地进程 | `docs/ops/development.md` |
| 构建与部署 | `Jenkinsfile`、`Dockerfile`、`deploy/`、GitHub Actions | CI、部署主机 | `docs/ops/deployment.md` |
| AI 交付流程 | `.ai/skills/`、`.specs/`、`scripts/quality/`、`scripts/spec/` | 开发 Agent、CI | `.ai/skills/README.md`、`.specs/README.md` |

## 维护边界

- 新增契约面时补充事实源、消费方和长期文档，不在 Skill 中复制这张表。
- 代码行为以真实实现和测试为准；本文与代码冲突时修正文档。
- 具体 Skill 的触发与转交只在 `.ai/skills/README.md` 和对应 `SKILL.md` 维护。
- 某次需求的计划、取舍和实施记录留在 `.specs/<KEY>/`，不写入本文。

# LinkCV

LinkCV 是用于编辑和导出简历的前后端分离 Monorepo。

## 仓库结构

```text
apps/web       React、TypeScript 与 Vite 前端
apps/extension WXT、React 与 TypeScript 浏览器岗位采集插件
apps/backend   Python 3.11+、FastAPI、SQLAlchemy 与 Alembic 后端
deploy         本地基础设施、Dev/Production Jenkins 与 Compose 部署配置
docs           长期维护的架构、API、模块与运维知识
```

Web、浏览器插件与后端项目可独立安装和构建；根目录命令用于协调三个应用及本地基础设施。

## 分支与交付

新的业务需求分支统一从最新 `origin/master` 创建。实现和本地验证完成后，先由该业务分支向 `release` 提交 PR；PR 合并且 `release` 分支测试通过后，再由同一业务分支向 `master` 提交 PR。不得从 `dev` 创建新的业务需求分支，也不得用 `release -> master` PR 代替业务分支回合 `master`。

完整的分支检查、提交、PR 和授权规则见 [`branch-pr-workflow`](.ai/skills/branch-pr-workflow/SKILL.md)，开发者流程见 [`docs/ops/development.md#分支与发布流程`](docs/ops/development.md#分支与发布流程)。

## 首次初始化

环境要求：

- Node.js 22 LTS 与 npm 10+
- uv
- Docker 与 Docker Compose（仅本地环境需要）

首次执行以下命令，安装根目录、Web 与 Python 的全部依赖：

```bash
npm run setup
```

### 共享开发环境

从已提交的开发环境模板创建本机私密覆盖文件：

```bash
cp .env.development .env.development.local
```

在 `.env.development.local` 填写必要的私密值，例如 `MYSQL_USER`、`MYSQL_PASSWORD`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY` 与 `JWT_SECRET`。然后通过一条命令同时启动 Web 和 FastAPI：

```bash
npm run dev:development
```

### 本地环境

创建本地配置、启动 MySQL 与 MinIO 后，再同时启动 Web 和 FastAPI：

```bash
cp .env.example .env
npm run infra:up
npm run dev:local
```

两个命令都会启动 Web（`http://127.0.0.1:5173`）与 FastAPI（`http://127.0.0.1:8000`）。API 文档位于 `http://127.0.0.1:8000/api/docs`；本地基础设施运行时，MinIO 控制台位于 `http://127.0.0.1:9001`。

Vite 会将所有相对 `/api` 请求代理到 FastAPI。鉴权使用有效期七天的 HttpOnly Cookie JWT；简历存储在 MySQL，私有图片存储在 MinIO。原型阶段的 SQLite 数据不会导入。

执行 `npm run check` 可运行全部检查；执行 `npm run build` 可构建 Vite 前端、Chrome MV3 插件和可安装的 Python 后端包。插件侧载步骤见 [`apps/extension/README.md`](apps/extension/README.md)。

当前架构与模块契约索引见 [`docs/README.md`](docs/README.md)。

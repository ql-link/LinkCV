# 构建与部署

## 当前状态

根级 `Dockerfile` 构建 Vite 静态产物和 FastAPI Python 环境。容器启动时先运行 `alembic upgrade head`，再由 Uvicorn 在 `8000` 端口提供 `/api` 与 Web 静态文件。

Jenkins 构建 `linkcv:<git-sha>` 镜像，并使用 `deploy/docker-compose.production.yml` 部署。生产 `.env` 必须提供 MySQL、MinIO 和 JWT 密钥；MySQL 与 MinIO 的生产实例不由该 Compose 文件创建。

`deploy/docker-compose.yml` 只用于本地启动 MySQL 8.4 和 MinIO。

## CI

`.github/workflows/quality.yml` 在面向 `dev`、`master` 的 PR 和对应分支 push 上执行根级 `npm run check`。本地和 CI 复用同一质量入口。

## 回滚

- 应用回滚通过把 `TAG` 切回上一镜像并重新执行 production Compose 完成。
- Alembic revision 必须保持向前兼容上一个应用版本；需要破坏性 Schema 变更时使用“扩展—迁移—收缩”步骤，不能依赖自动 downgrade。
- 原型 Express/SQLite 数据不进入新 MySQL 数据库，也不作为生产回滚路径。

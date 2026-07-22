# 构建与部署

## 当前状态

仓库仍保留旧 Express 应用的 Jenkins 部署拓扑。`Jenkinsfile` 构建根级 Docker 镜像，并用 `deploy/docker-compose.legacy.yml` 在服务器运行 `4174` 端口服务，数据目录挂载到 `/opt/tolink/LinkCV/data`。

`deploy/docker-compose.yml` 只用于本地启动 MySQL 8.4 和 MinIO，不代表 FastAPI 已经进入生产部署。

## CI

`.github/workflows/quality.yml` 在面向 `dev`、`master` 的 PR 和对应分支 push 上执行根级 `npm run check`。本地和 CI 应复用同一质量入口；差异化的 Git 变更范围由文档同步检查自动识别。

## 过渡约束

- 在 FastAPI 生产镜像、数据库迁移、健康检查和回滚方案落地前，不把本地 Compose 描述成生产拓扑。
- 不在业务迁移完成前删除 `deploy/docker-compose.legacy.yml` 或旧镜像入口。
- 部署变量、端口、健康检查路径或服务归属变化时，同步本文档与相关运行时契约。

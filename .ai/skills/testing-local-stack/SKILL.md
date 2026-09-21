---
name: testing-local-stack
description: 在无 Docker 的 Devin macOS 机器上为 LinkResume 起本地全栈（brew 版 MySQL/Redis/MinIO + .env + db:init + dev:local），并在无 CDP/AppleEvents-JS 的 Chrome 下用 DevTools 采样器做 DOM 级断言。适用于需要在真实浏览器做功能验收但本机缺容器运行时或浏览器调试通道的任务。
---

# 本地栈与浏览器断言技巧

## 本机没有 Docker 时的本地中间件

本机无 docker/colima/orbstack，共享 dev 栈（100.86.10.52）不一定可达。需要本地 MySQL/Redis/MinIO 时用 brew：

```bash
brew install mysql@8.4 redis minio
brew services start mysql@8.4            # 3306，root 免密
/opt/homebrew/opt/redis/bin/redis-server --requirepass 'linkresume-redis-local-change-me' --port 6379 --dir /tmp/linkcv-redis --daemonize yes
MINIO_ROOT_USER=linkresume MINIO_ROOT_PASSWORD='linkresume-minio-local-change-me' \
  nohup /opt/homebrew/opt/minio/bin/minio server /tmp/linkcv-minio --address :9000 --console-address :9001 &
/opt/homebrew/opt/mysql@8.4/bin/mysql -u root -e "CREATE USER 'linkresume'@'127.0.0.1' IDENTIFIED BY 'linkresume-local-change-me'; CREATE USER 'linkresume'@'localhost' IDENTIFIED BY 'linkresume-local-change-me'; CREATE DATABASE IF NOT EXISTS linkresume CHARACTER SET utf8mb4; GRANT ALL ON linkresume.* TO 'linkresume'@'127.0.0.1'; GRANT ALL ON linkresume.* TO 'linkresume'@'localhost'; FLUSH PRIVILEGES;"
```

## .env 与启动

- `.env` 在 gitignore 内，可直接生成：`grep -v '^RABBITMQ_URL=' .env.example > .env`；去掉 RABBITMQ_URL 后 MQ publisher 不构建（不导入简历即可不要 RabbitMQ）。JWT_SECRET 非 production 不校验，但建议 `openssl rand -hex 32`。
- backend `load_settings()` 直接读仓库根 `.env`，无需手动注入环境变量。
- `npm run dev:local` 之前必须先跑一次根目录 `npm install`（`concurrently` 是根 devDependency，blueprint 只装了 apps/web 和 backend）。
- `dev:services` 含 worker（无 RabbitMQ 会退出）与 pi-service（缺 third_party/pi 构建会退出）——两者失败不阻塞 web/backend，分别对应导入流水线与 AI Agent，纯编辑器验收可忽略。
- 迁移：`npm run db:init`（init_mysql.py 用 .env 的 URL 建库 + alembic upgrade head）。演示账号不存在于新库：APP_ENV=local 开放邮箱注册，直接在 UI 注册 `devin.demo@example.com` 即可（Devin Secrets 里的 LINKCV_DEMO_PASSWORD 是为此账号准备的密码）。
- MinIO/Redis 启动失败在 lifespan 里只是告警；但登录会话写 Redis，**Redis 必须可用**，MinIO 仅影响资源上传。

## Chrome 无 CDP 时的 DOM 断言

本机 Chrome 未开 `--remote-debugging-port`，`browser_console`/`read_dom` 不可用；Chrome 153+ 默认 profile 也不接受该 flag；Apple Events JS（View ▸ Developer ▸ Allow JavaScript from Apple Events）可能点了不生效。可用兜底：DevTools Console（Cmd+Opt+J）里挂采样器，关 DevTools 后正常操作，最后导出：

```js
window.__log=[];setInterval(()=>{ /* 采集 toolbar/history/scale/getClientRects 等 */ window.__log.push({...}) },400)
// 操作完成后重开 DevTools：
copy(window.__log)   // 然后 shell: pbpaste > log.json 再解析
```

注意：DevTools 聚焦会让 tiptap BubbleMenu 卸载工具条 DOM（直接探针拿到空），所以必须"挂后台采样 → 关 DevTools 操作页面 → 重开导出"。

## 其它交互要点

- macOS 窗口拉满：osascript bounds 用**真实像素**（本机 1600x1200），不是工具坐标 1024x768：`set bounds of front window to {0,0,1600,1200}`。
- 编辑器选中一段文字：`triple_click` 选中整段比 left_click_drag 更稳。
- 画布缩放：computer `scroll` 支持 `text:"ctrl"` 修饰（Ctrl+滚轮 → 0.5–1.6，步进 0.08）。
- 编辑器气泡只在文字选区非空时出现；点页外会折叠选区。
- 截图落盘：`screencapture -x /tmp/x.png` 有权限；computer `zoom` 可给指定区域出高清图。

## Devin Secrets Needed

- `LINKCV_DEMO_PASSWORD`：演示账号密码，仅本地栈有效。

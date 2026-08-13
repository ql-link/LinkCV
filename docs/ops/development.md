# 本地开发与配置

## 环境要求

- Node.js 22 LTS 和 npm 10+
- Python 3.11–3.13，由 uv 管理
- Docker 和 Docker Compose

新环境执行 `npm run setup` 安装 Web、浏览器插件和后端依赖。复制 `.env.example` 为被 Git 忽略的 `.env` 后，使用 `npm run infra:up` 启动 MySQL、Redis、MinIO 与 RabbitMQ，`npm run db:init` 创建独立 `linkcv` 数据库并应用 Alembic，`npm run dev` 同时启动 Web、FastAPI 和简历导入 Worker。当前 Alembic head `0020`；`0002`–`0005` 建立并演进简历、版本和对象清理，`0006` 新增 LLM 模型配置和调用日志表，`0007` 新增用户私有 JD 单表，`0008` 增加 Chat 候选模型、唯一当前绑定与调用快照，`0009` 曾新增管理员操作审计日志表，`0010` 在对象删除改为同步后移除清理任务表，`0011` 移除仅写不读的管理员操作审计日志表，`0012` 删除已停用的旧版简历内容与样式备份列，`0013` 为简历分享新增字段，`0016` 新增导入任务表，`0017` 在旧同步导入数据清理后移除正式简历上的旧导入证据列，`0018` 新增用户知识库资料表，`0019` 新增 `users.wechat_openid` 唯一绑定与绑定时间，`0020` 将 `email`、`password_hash` 放宽为可空以支持微信扫码登录建号。

后端默认读取仓库根目录 `.env`。设置 `LINKCV_ENV_FILE=.env.development` 可选择共享 Dev 基础配置；如果同目录存在 `.env.development.local`，其密码和密钥会覆盖基础文件。Production 同理使用 `.env.production` + `.env.production.local`：仓库文件维护 Cloud Docker DNS 地址，私密文件只提供账号、密码和密钥，不覆盖 `DATABASE_URL`、`REDIS_URL` 或 `MINIO_ENDPOINT`。进程环境变量优先级最高，配置路径不受当前工作目录影响。

LLM 模型 API key 通过管理员 API 加密进入 MySQL，Fernet 根密钥环必须留在私密 env。格式为 `LLM_CREDENTIAL_ENCRYPTION_KEYS=<keyId>:<fernetKey>`；轮换时把新 key 放在首项，旧 key 以逗号分隔继续保留。可用以下命令生成一个虚构开发 key，输出只应写入被 Git 忽略的 `.env.local` 或 `.env.development.local`：

仓库环境模板中的大模型凭据与鉴权会话说明使用中文注释；环境变量键名及上述密钥环格式仍是稳定的英文机器契约，不随注释语言改变。

```bash
uv run --directory apps/backend python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

local/test 未配置密钥环时，原有非 LLM 接口仍可启动，但保存或解密模型凭据会返回 `LLM_CREDENTIALS_UNAVAILABLE`。Production 必须配置有效密钥环，否则后端拒绝启动。真实模型联调还需要管理员账号、供应商凭据和余额；自动化测试使用 Fake gateway，不访问外部服务。

`.env.development` 复用 LinkRag Dev 的 MySQL、Redis 与 MinIO 服务地址，但数据库固定为独立的 `linkcv`，Redis 固定使用隔离的 DB 2，MinIO 固定使用独立 `linkcv` bucket；不得改为 `tolink_rag_db` 或 DB 0。首次初始化使用：

```bash
LINKCV_ENV_FILE=.env.development npm run db:init
```

命令先校验并创建 `linkcv`，再升级到当前 Alembic head `0020`。图片、导入源文件和插件制品读写使用 `MINIO_*` 配置；Bucket 保持私有。

`PLUGIN_RELEASE_ORIGIN` 是当前环境允许正式插件访问的 LinkCV 根 Origin。默认本地值为 `http://127.0.0.1:5173`；共享 Development 和 Production 必须在各自 `.local` 覆盖中写入用户实际访问的 Origin，Production 只接受 HTTPS。该值必须与构建安装包时传给 `build_extension_release.py` 的对应 Origin 一致，否则管理员上传会被拒绝。

微信绑定与扫码登录要求同时配置 `WECHAT_APPID` 与 `WECHAT_SECRET`（两者均为非占位符才开启能力开关，否则 profile 返回 `unavailable`、相关接口返回 `503 WECHAT_SERVICE_UNAVAILABLE`）。`WECHAT_QR_PAGE` 是绑定用小程序码页（默认 `pages/bind/bind`），`WECHAT_LOGIN_PAGE` 是扫码登录确认页（默认 `pages/login/index`）；`WECHAT_BIND_TICKET_TTL_SECONDS`（默认 300）与 `WECHAT_SCENE_TTL_SECONDS`（默认 300）分别控制绑定票据与登录 scene 的 Redis 有效期，`WECHAT_QRCODE_REQUESTS_PER_MINUTE`（默认 10）限制登录二维码按 IP 的生成频率。

## 默认端口与覆盖

| 服务          | 默认端口 | 配置入口                                            |
| ------------- | -------: | --------------------------------------------------- |
| Vite Web      |     5173 | Vite 默认值                                         |
| FastAPI       |     8000 | `BACKEND_HOST`、`BACKEND_PORT`                      |
| MySQL         |     3306 | `MYSQL_HOST`、`MYSQL_PORT`                          |
| Redis         |     6379 | `REDIS_HOST`、`REDIS_PORT`、`REDIS_DB`、`REDIS_URL` |
| MinIO API     |     9000 | `MINIO_API_PORT`、`MINIO_ENDPOINT`                  |
| MinIO Console |     9001 | `MINIO_CONSOLE_PORT`                                |
| RabbitMQ AMQP |     5672 | `RABBITMQ_PORT`、`RABBITMQ_URL`                     |
| RabbitMQ UI   |    15672 | `RABBITMQ_MANAGEMENT_PORT`                          |

`BACKEND_PROXY_TARGET` 可以覆盖 Vite 使用的完整 FastAPI 地址。数据库可以用完整 `DATABASE_URL` 覆盖分项 MySQL 配置，Redis 可以用 `REDIS_URL` 覆盖分项配置。Production 必须通过私密覆盖提供足够随机的 `JWT_SECRET`、`LLM_CREDENTIAL_ENCRYPTION_KEYS`、`LINKPARSE_API_KEY`、MySQL 和 MinIO 凭据，否则后端拒绝启动。鉴权会话和简历导入幂等共用 `REDIS_*` 指向的隔离数据库。

Web 源码中的 `@/` 指向 `apps/web/src/`；Vite、TypeScript 与 Vitest 都维护相同别名。新增 shadcn 组件时从 `apps/web` 运行 CLI，使 `components.json` 能把源码写入 `src/components/ui/`。

## 日志配置

| 环境变量 | 默认/环境值 | 作用 |
| --- | --- | --- |
| `LOG_LEVEL` | `INFO` | Python 根日志级别 |
| `LOG_SERVICE_NAME` | `linkcv` | JSONL 与 Loki 的固定服务标识，非 `linkcv` 输入会归一化 |
| `LOG_DIRECTORY` | local `.runtime/logs`；容器 `/app/logs` | 本地 JSONL 缓冲目录；为空时只写 stderr |
| `LOG_RETENTION_DAYS` | `7` | 本地轮转文件清理窗口，非 7 输入会归一化 |
| `LOKI_QUERY_URL` | local 空；Dev/Production 为对应内网 DNS | 仅 FastAPI 管理查询使用，Web 不读取 |
| `LOKI_QUERY_TIMEOUT_SECONDS` | `5` | 单次 Loki 查询预算，不自动重试 |
| `LOKI_PUSH_URL` | local 空；Dev/Production 为对应 push URL | 仅 Promtail 读取，应用 Settings 忽略 |

本地直接运行 FastAPI 不要求 Loki 或 Promtail；JSONL 仍写入 `.runtime/logs`，管理查询在 `LOKI_QUERY_URL` 为空时返回 `503 LOG_QUERY_UNAVAILABLE`。不要把 Loki 地址或任意 LogQL 暴露给浏览器。真实日志联调使用虚构账号和内容，并检查 request ID、审计目标、脱敏与七天时间窗。

需要与本机 LinkRag 的 Loki 联调时，先确认 LinkRag 本地 Compose 的 `loki` 和 `promtail` 已启动，再执行 `npm run observability:up`。该命令启动独立的 `linkcv-local-promtail`，默认加入 `tolink-rag-local_tolink-net`、读取 `.runtime/logs`，并推送到网络内的 `http://loki:3100`。LinkRag 和 LinkCV 因此各自维护 Promtail 与 positions，互不读取对方文件；停止 LinkCV 采集器使用 `npm run observability:down`，不会停止或删除共享 Loki。

如 LinkRag 使用了其他 Compose project/network，可通过 `LOKI_DOCKER_NETWORK` 覆盖网络名；LinkCV 日志目录可通过 `LINKCV_LOG_PATH` 覆盖。需要让本地 FastAPI 管理端查询该 Loki 时，为进程设置 `LOKI_QUERY_URL=http://127.0.0.1:3100`，该地址不传给浏览器。

微信扫码登录需要 `WECHAT_APPID` 与 `WECHAT_APPSECRET`（个人主体小程序，体验版/正式版均可）；`WECHAT_LOGIN_PAGE` 指定小程序登录确认页（默认 `pages/login/index`）。`WECHAT_QRCODE_REQUESTS_PER_MINUTE`（默认 10）控制二维码请求的按 IP 限流，`WECHAT_SCENE_TTL_SECONDS`（默认 300）控制 scene 有效期，`WECHAT_TIMEOUT_SECONDS`（默认 5）控制微信上游调用超时。Development 未配置微信凭据时仍可启动应用，但二维码接口会返回 `WECHAT_UNAVAILABLE`；Production 缺 `WECHAT_APPID`/`WECHAT_APPSECRET` 会拒绝启动。

## 简历导入与版本配置

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `RESUME_VERSION_LIMIT` | `10` | 单份简历可保存的版本上限，达到后拒绝新增并由用户手动删除旧版本；最小为 2 |
| `DATASET_UPLOAD_MAX_BYTES` | `10485760` | 知识库资料单文件上传大小上限 |
| `RESUME_IMPORT_MAX_BYTES` | `10485760` | 上传原文件大小上限 |
| `RESUME_MARKDOWN_MAX_BYTES` | `2097152` | 转换后 Markdown 大小上限 |
| `RESUME_STRUCTURING_MAX_BYTES` | `131072` | 允许发送到结构化模型的 Markdown 大小上限 |
| `RESUME_IMPORT_REQUESTS_PER_MINUTE` | `3` | 单用户每分钟最多进入的导入请求数 |
| `RESUME_IMPORT_GLOBAL_CONCURRENCY` | `4` | 单个 FastAPI 进程的导入全局并发上限 |
| `RESUME_IMPORT_USER_CONCURRENCY` | `1` | 单个 FastAPI 进程内单用户导入并发上限 |
| `RESUME_STRUCTURING_TIMEOUT_SECONDS` | `60` | 统一模型结构化阶段的最大时限 |
| `RESUME_IMPORT_UPLOAD_STALE_SECONDS` | `120` | 上传中记录的陈旧收口时限 |
| `RESUME_IMPORT_PARSE_DEADLINE_SECONDS` | `180` | Worker 单个任务解析业务时限 |
| `RESUME_IMPORT_PARSE_STALE_SECONDS` | `240` | 解析中记录的陈旧收口时限，必须大于解析时限 |
| `RESUME_IMPORT_WORKER_LOCK_SECONDS` | `240` | Redis Worker 防重锁时长 |
| `RESUME_IMPORT_IDEMPOTENCY_BIND_TTL_SECONDS` | `30` | 请求占有但尚未绑定导入 ID 的短 TTL |
| `RESUME_IMPORT_IDEMPOTENCY_TTL_SECONDS` | `900` | 请求指纹到导入 ID 映射的重放窗口 |
| `RESUME_IMPORT_WORKER_CONCURRENCY` | `4` | Worker 消费预取并发 |
| `MQ_VENDOR` | `rabbitmq` | Broker 实现，可显式切换为 `kafka` |
| `RABBITMQ_URL` | 本地 RabbitMQ | AMQP 地址；Dev/Production 由私密覆盖提供 |
| `RABBITMQ_EXCHANGE_NAME` | `tolink.cv.resume_import` | durable direct exchange |
| `RABBITMQ_QUEUE` | `linkcv.resume_import.worker` | durable Worker queue |
| `RABBITMQ_ROUTING_KEY` | `resume.import` | RabbitMQ 固定业务路由 |
| `LINKPARSE_BASE_URL` | `http://100.86.10.52:18743` | PDF 解析服务地址 |
| `LINKPARSE_API_KEY` | 空 | LinkParse Bearer 凭据，只放 `.local` 或进程环境 |
| `LINKPARSE_PARSE_PATH` | `/v1/parse` | 同步 PDF 解析路径 |
| `LINKPARSE_TIMEOUT_SECONDS` | `90` | 单次 LinkParse 阶段时限，不自动重试 |
| `LINKPARSE_RESPONSE_MAX_BYTES` | `3145728` | LinkParse 响应读取上限 |
| `DOCX_CONVERSION_TIMEOUT_SECONDS` | `30` | Mammoth 子进程转换时限 |
| `WECHAT_APPID` | 空 | 微信小程序 appid；与 `WECHAT_SECRET` 同时配置才启用微信绑定 |
| `WECHAT_SECRET` | 空 | 微信小程序密钥，只放 `.local` 或进程环境 |
| `WECHAT_QR_PAGE` | `pages/bind/bind` | 小程序码跳转的绑定确认页路径 |
| `WECHAT_BIND_TICKET_TTL_SECONDS` | `300` | 微信绑定票据有效期，60~900 秒 |
| `WECHAT_API_TIMEOUT_SECONDS` | `5` | 单次微信开放平台调用超时 |
| `REDIS_CONNECT_TIMEOUT_SECONDS` | `2` | Redis 连接超时 |
| `REDIS_SOCKET_TIMEOUT_SECONDS` | `2` | Redis 操作超时 |
| `LLM_TIMEOUT_SECONDS` | `75` | 统一托管 LLM Gateway 的单次请求超时 |

Markdown 和 DOCX 导入不调用 LinkParse，但 Worker 仍需要数据库中已配置当前 Chat binding。PDF 会把原始二进制和安全文件名发送到 LinkParse；浏览器不读取地址或 Key。API 的频率与受理并发限制保存在 FastAPI 进程内，请求幂等和 Worker 防重保存在 Redis，任务终态保存在 MySQL。默认自动化测试注入 Fake，不访问真实地址或读取 Key。

简历导入使用数据库驱动的统一 LLM 服务和当前 Chat binding。模型地址、模型调用名与 API Key 通过管理员 API 管理，凭据由 `LLM_CREDENTIAL_ENCRYPTION_KEYS` 加解密；调用不自动重试，也不回退其他候选。环境只保留密钥环与统一的 `LLM_TIMEOUT_SECONDS`，不再配置导入专用 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 或重试参数。

本地 PDF 联调时，把 `LINKPARSE_API_KEY=<受控凭据>` 写入被 Git 忽略的 `.env.local` 或 `.env.development.local`，不要写入三份仓库环境文件、命令行历史、日志或测试 fixture。Key 缺失时 Development 仍可启动，Markdown/DOCX 可测，PDF 明确返回 `DOCUMENT_CONVERSION_UNAVAILABLE`。

## 常用命令

| 命令                                  | 作用                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| `npm run db:migrate`                  | 将数据库升级到 Alembic 最新版本                                      |
| `npm run db:init`                     | 仅允许创建 `linkcv` 数据库并升级到 Alembic head                      |
| `npm run db:revision -- -m <message>` | 创建只调用 SQL 的 revision，以及同 ID 的 `.up.sql`、`.down.sql` 文件 |
| `npm run test:web`                    | 前端 Vitest 单元和组件测试                                           |
| `npm run dev:extension`               | 启动 WXT 插件开发模式                                                |
| `npm run test:extension`              | 插件 DOM 提取与 API 客户端测试                                       |
| `npm run build:extension`             | 构建可侧载的 Chrome MV3 目录                                         |
| `uv run --directory apps/backend python ../../scripts/release/build_extension_release.py ...` | 生成并校验 Development/Production 插件发布 ZIP 与 SHA256SUMS |
| `npm run test:backend:unit`           | 后端快速单元测试                                                     |
| `npm run test:backend:integration`    | 后端隔离 HTTP 集成测试                                               |
| `npm run test:backend`                | 全部后端和仓库工具测试                                               |
| `npm run check`                       | 完整本地质量入口                                                     |

## 测试分层

- 前端测试使用 Vitest、React Testing Library 和 jsdom，通过 Mock 隔离 API。
- 后端单元测试不访问外部服务；集成测试使用内存 SQLite 和假 MinIO。
- 跨浏览器插件、BOSS 页面、Web、FastAPI、真实 MySQL 和 Redis 的完整导入流程由浏览器人工验证。侧载目录和步骤见 [`apps/extension/README.md`](../../apps/extension/README.md)。

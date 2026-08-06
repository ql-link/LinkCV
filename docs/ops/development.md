# 本地开发与配置

## 环境要求

- Node.js 22 LTS 和 npm 10+
- Python 3.11–3.13，由 uv 管理
- Docker 和 Docker Compose

新环境执行 `npm run setup` 安装 Web、浏览器插件和后端依赖。复制 `.env.example` 为被 Git 忽略的 `.env` 后，使用 `npm run infra:up` 启动 MySQL、Redis 与 MinIO，`npm run db:init` 创建独立 `linkcv` 数据库并应用 Alembic，`npm run dev` 同时启动 Web 和 FastAPI。当前 Alembic head `0012`；`0002`–`0005` 建立并演进简历、版本和对象清理，`0006` 新增 LLM 模型配置和调用日志表，`0007` 新增用户私有 JD 单表，`0008` 增加 Chat 候选模型、唯一当前绑定与调用快照，`0009` 曾新增管理员操作审计日志表，`0010` 在对象删除改为同步后移除清理任务表，`0011` 移除仅写不读的管理员操作审计日志表，`0012` 删除已停用的旧版简历内容与样式备份列。

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

命令先校验并创建 `linkcv`，再升级到当前 Alembic head `0012`。图片读写使用 `MINIO_*` 配置。

## 默认端口与覆盖

| 服务          | 默认端口 | 配置入口                                            |
| ------------- | -------: | --------------------------------------------------- |
| Vite Web      |     5173 | Vite 默认值                                         |
| FastAPI       |     8000 | `BACKEND_HOST`、`BACKEND_PORT`                      |
| MySQL         |     3306 | `MYSQL_HOST`、`MYSQL_PORT`                          |
| Redis         |     6379 | `REDIS_HOST`、`REDIS_PORT`、`REDIS_DB`、`REDIS_URL` |
| MinIO API     |     9000 | `MINIO_API_PORT`、`MINIO_ENDPOINT`                  |
| MinIO Console |     9001 | `MINIO_CONSOLE_PORT`                                |

`BACKEND_PROXY_TARGET` 可以覆盖 Vite 使用的完整 FastAPI 地址。数据库可以用完整 `DATABASE_URL` 覆盖分项 MySQL 配置，Redis 可以用 `REDIS_URL` 覆盖分项配置。Production 必须通过私密覆盖提供足够随机的 `JWT_SECRET`、`LLM_CREDENTIAL_ENCRYPTION_KEYS`、`LINKPARSE_API_KEY`、MySQL 和 MinIO 凭据，否则后端拒绝启动。鉴权会话与简历导入幂等状态共用 `REDIS_*` 指向的隔离数据库；`ACCESS_TTL_MINUTES`、`ACCESS_COOKIE_NAME` 和 `REFRESH_COOKIE_NAME` 控制双 Token 的有效期与 Cookie 名称。

## 简历导入与版本配置

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `RESUME_VERSION_LIMIT` | `10` | 单份简历可保存的版本上限，达到后拒绝新增并由用户手动删除旧版本；最小为 2 |
| `RESUME_IMPORT_MAX_BYTES` | `10485760` | 上传原文件大小上限 |
| `RESUME_MARKDOWN_MAX_BYTES` | `2097152` | 转换后 Markdown 大小上限 |
| `RESUME_STRUCTURING_MAX_BYTES` | `131072` | 允许发送到结构化模型的 Markdown 大小上限 |
| `RESUME_IMPORT_REQUESTS_PER_MINUTE` | `3` | 单用户每分钟最多进入的导入请求数 |
| `RESUME_IMPORT_GLOBAL_CONCURRENCY` | `4` | 单个 FastAPI 进程的导入全局并发上限 |
| `RESUME_IMPORT_USER_CONCURRENCY` | `1` | 单个 FastAPI 进程内单用户导入并发上限 |
| `RESUME_IMPORT_DEADLINE_SECONDS` | `180` | 一次同步导入的总业务时限 |
| `RESUME_STRUCTURING_TIMEOUT_SECONDS` | `60` | 统一模型结构化阶段的最大时限 |
| `RESUME_IMPORT_IDEMPOTENCY_PROCESSING_TTL_SECONDS` | `240` | Redis processing 租约；必须至少比总 deadline 多 30 秒 |
| `RESUME_IMPORT_IDEMPOTENCY_SUCCESS_TTL_SECONDS` | `3600` | 成功结果重放窗口 |
| `RESUME_IMPORT_IDEMPOTENCY_FAILURE_TTL_SECONDS` | `60` | 失败结果短期重放窗口 |
| `LINKPARSE_BASE_URL` | `http://100.86.10.52:18743` | PDF 解析服务地址 |
| `LINKPARSE_API_KEY` | 空 | LinkParse Bearer 凭据，只放 `.local` 或进程环境 |
| `LINKPARSE_PARSE_PATH` | `/v1/parse` | 同步 PDF 解析路径 |
| `LINKPARSE_TIMEOUT_SECONDS` | `90` | 单次 LinkParse 阶段时限，不自动重试 |
| `LINKPARSE_RESPONSE_MAX_BYTES` | `3145728` | LinkParse 响应读取上限 |
| `DOCX_CONVERSION_TIMEOUT_SECONDS` | `30` | Mammoth 子进程转换时限 |
| `REDIS_CONNECT_TIMEOUT_SECONDS` | `2` | Redis 连接超时 |
| `REDIS_SOCKET_TIMEOUT_SECONDS` | `2` | Redis 操作超时 |
| `LLM_TIMEOUT_SECONDS` | `75` | 统一托管 LLM Gateway 的单次请求超时 |

Markdown 和 DOCX 导入不调用 LinkParse，但仍需要数据库中已经配置当前 Chat binding，且其供应商与模型支持结构化输出。PDF 会把原始二进制和安全文件名发送到 LinkParse；浏览器不读取地址或 Key。频率和并发限制仍保存在 FastAPI 进程内，幂等状态保存在 Redis。默认自动化测试注入 Fake，不访问真实地址或读取 Key。真实简历属于敏感数据，联调前必须确认 LinkParse 的源文件、结果、临时文件和日志保留边界，以及目标环境到当前 HTTP 地址的传输保护。

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
| `npm run test:backend:unit`           | 后端快速单元测试                                                     |
| `npm run test:backend:integration`    | 后端隔离 HTTP 集成测试                                               |
| `npm run test:backend`                | 全部后端和仓库工具测试                                               |
| `npm run check`                       | 完整本地质量入口                                                     |

## 测试分层

- 前端测试使用 Vitest、React Testing Library 和 jsdom，通过 Mock 隔离 API。
- 后端单元测试不访问外部服务；集成测试使用内存 SQLite 和假 MinIO。
- 跨浏览器插件、BOSS 页面、Web、FastAPI、真实 MySQL 和 Redis 的完整导入流程由浏览器人工验证。侧载目录和步骤见 [`apps/extension/README.md`](../../apps/extension/README.md)。

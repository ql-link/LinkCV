# 本地开发与配置

## 环境要求

- Node.js 22 LTS 和 npm 10+
- Python 3.11–3.13，由 uv 管理
- Docker 和 Docker Compose

新环境执行 `npm run setup` 安装 Web、浏览器插件和后端依赖。复制 `.env.example` 为被 Git 忽略的 `.env` 后，使用 `npm run infra:up` 启动 MySQL、Redis 与 MinIO，`npm run db:init` 创建独立 `linkcv` 数据库并应用 Alembic，`npm run dev` 同时启动 Web 和 FastAPI。当前 Alembic head `0009`；`0002`–`0005` 建立并演进简历、版本和对象清理，`0006` 新增 LLM 模型配置和调用日志表，`0007` 新增用户私有 JD 单表，`0008` 增加 Chat 候选模型、唯一当前绑定与调用快照，`0009` 新增管理员操作审计日志表。

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

命令先校验并创建 `linkcv`，再升级到当前 Alembic head `0009`。图片读写使用 `MINIO_*` 配置。

## 默认端口与覆盖

| 服务          | 默认端口 | 配置入口                                            |
| ------------- | -------: | --------------------------------------------------- |
| Vite Web      |     5173 | Vite 默认值                                         |
| FastAPI       |     8000 | `BACKEND_HOST`、`BACKEND_PORT`                      |
| MySQL         |     3306 | `MYSQL_HOST`、`MYSQL_PORT`                          |
| Redis         |     6379 | `REDIS_HOST`、`REDIS_PORT`、`REDIS_DB`、`REDIS_URL` |
| MinIO API     |     9000 | `MINIO_API_PORT`、`MINIO_ENDPOINT`                  |
| MinIO Console |     9001 | `MINIO_CONSOLE_PORT`                                |

`BACKEND_PROXY_TARGET` 可以覆盖 Vite 使用的完整 FastAPI 地址。数据库可以用完整 `DATABASE_URL` 覆盖分项 MySQL 配置，Redis 可以用 `REDIS_URL` 覆盖分项配置。Production 必须通过私密覆盖提供足够随机的 `JWT_SECRET`、`LLM_CREDENTIAL_ENCRYPTION_KEYS`、MySQL 和 MinIO 凭据，否则后端拒绝启动。鉴权会话使用 `REDIS_*` 配置的 Redis 作为唯一会话存储；`ACCESS_TTL_MINUTES`、`ACCESS_COOKIE_NAME` 和 `REFRESH_COOKIE_NAME` 控制双 Token 的有效期与 Cookie 名称。

## 简历导入与版本配置

| 环境变量                            | 默认值                   | 作用                                                                     |
| ----------------------------------- | ------------------------ | ------------------------------------------------------------------------ |
| `RESUME_VERSION_LIMIT`              | `10`                     | 单份简历可保存的版本上限，达到后拒绝新增并由用户手动删除旧版本；最小为 2 |
| `RESUME_IMPORT_MAX_BYTES`           | `10485760`               | 上传原文件大小上限                                                       |
| `RESUME_MARKDOWN_MAX_BYTES`         | `2097152`                | RAG Markdown 大小上限                                                    |
| `RESUME_STRUCTURING_MAX_BYTES`      | `131072`                 | 允许发送到结构化模型的 Markdown 大小上限                                 |
| `RESUME_IMPORT_REQUESTS_PER_MINUTE` | `3`                      | 单用户每分钟最多进入的导入请求数                                         |
| `RESUME_IMPORT_GLOBAL_CONCURRENCY`  | `4`                      | 单个 FastAPI 进程的导入全局并发上限                                      |
| `RESUME_IMPORT_USER_CONCURRENCY`    | `1`                      | 单个 FastAPI 进程内单用户导入并发上限                                    |
| `RAG_BASE_URL`                      | 空                       | tolink-rag 服务地址；为空时 DOCX/PDF 导入明确不可用                      |
| `RAG_API_KEY`                       | 空                       | 可选 Bearer 凭据，只放 `.local` 或进程环境                               |
| `RAG_CONVERT_PATH`                  | `/documents/to-markdown` | 文件转 Markdown 接口路径；取得真实契约后覆盖                             |
| `RAG_TIMEOUT_SECONDS`               | `60`                     | 单次转换超时                                                             |
| `LLM_BASE_URL`                      | 空                       | 简历导入使用的 OpenAI-compatible 结构化输出服务地址                      |
| `LLM_API_KEY`                       | 空                       | 简历导入模型凭据，只放私密覆盖                                           |
| `LLM_MODEL`                         | 空                       | 简历导入模型名；与地址任一为空时结构化导入明确不可用                     |
| `LLM_STRUCTURED_PATH`               | `/chat/completions`      | 简历导入 JSON Schema 请求路径                                            |
| `LLM_TIMEOUT_SECONDS`               | `60`                     | 两条 LLM 链路共享的单次请求超时                                          |
| `LLM_MAX_RETRIES`                   | `1`                      | 仅简历导入结构化客户端使用的最大额外重试次数，范围 0–2                   |

Markdown 导入不调用 tolink-rag，但仍需要独立配置的结构化模型。频率和并发限制保存在 FastAPI 进程内，当前单实例部署可直接使用；多进程或多副本部署必须在 Redis 或 API 网关实施共享额度。默认自动化测试注入 Fake，不读取真实地址或密钥。真实简历属于敏感数据，联调前必须确认 tolink-rag 和模型环境的数据处理边界。

数据库驱动的 Chat 服务与简历导入结构化 Adapter 暂时使用两组连接配置。Chat 的 adapter、模型调用名、API Base 和供应商 API Key 只从管理员 API 与 MySQL 候选取得，`LLM_CREDENTIAL_ENCRYPTION_KEYS` 用于加解密候选凭据；不存在当前 Chat 模型时明确失败，不回退 LiteLLM provider 环境变量。简历导入继续读取 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_STRUCTURED_PATH` 和 `LLM_MAX_RETRIES`。两条链路共享 `LLM_TIMEOUT_SECONDS`，但模型选择、凭据、重试和日志彼此独立；管理端 Chat 调用始终设置零重试。

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

# third_party/pi 与独立 Agent 服务

## 代码来源与构建

`third_party/pi` 是 [earendil-works/pi](https://github.com/earendil-works/pi) 的一次性 subtree 引入；后续修改作为 LinkCV 自有代码维护，不持续跟踪上游。它保持独立 npm workspaces，LinkCV 根级脚本通过显式的 `pi:setup`、`test:pi` 和 `check:pi` 纳入安装与质量检查。

Pi 的模型目录由构建期静态数据提供。仓库保存与 `@earendil-works/pi-ai@0.84.2` 对应的 `packages/ai/src/providers/data/` 快照，`npm run check:model-data` 校验其完整性，`npm run build:offline` 不在 CI 或镜像构建期间访问 models.dev。升级 Pi 版本时必须同时更新并校验该快照，不能混用其他版本的 provider data。

## 独立服务边界

`apps/pi-service` 是无头 Node 服务，使用 `third_party/pi/packages/coding-agent` 构建产物执行 Agent loop；它不嵌入 FastAPI 容器，也不直接连接 MySQL、Redis 或 MinIO。根级 `npm run dev` 会并行启动 Web、FastAPI、Worker 与 Pi 服务；单独调试可运行 `npm run dev:pi`。服务只暴露：

- `GET /health`：不鉴权的容器健康检查；
- `POST /internal/probes`：以 Bearer 服务令牌接收待绑定候选快照，要求模型执行固定无副作用 Tool，并返回验证用量；
- `GET /internal/agent/readiness`：以 Bearer 服务令牌校验 Pi 到 FastAPI 的回调鉴权、当前 `pi_agent` 模型配置和 provider 映射；
- `POST /internal/agent/runs`：FastAPI 以 Bearer 服务令牌提交运行，响应 SSE；
- `POST /internal/agent/runs/:runId/cancel`：取消当前进程内正在执行的运行。

Pi 服务启动时使用 SDK 的 HTTP dispatcher 读取 `HTTP_PROXY`、`HTTPS_PROXY` 与 `NO_PROXY`，因此模型供应商请求和 FastAPI 内部回调遵循部署环境的代理设置；未配置代理时保持直接连接。SDK 以 `stopReason=error` 返回的供应商超时转换为 `run.failed/AGENT_MODEL_TIMEOUT`，其他模型请求失败转换为 `AGENT_MODEL_REQUEST_FAILED`，不能以没有助手消息的 `run.completed` 结束。只有成功终态才携带安全化 Token/成本用量并把完整助手文本写入 MySQL；失败、取消和无终态 EOF 不持久化部分助手文本。

Pi 服务关闭上游默认的 `read`、`bash`、`edit`、`write` coding tools，再显式注册三个受控工具：`read` 只能读取 `apps/pi-service/resources/skills/` 下的 Markdown，不能访问环境文件或其他服务端路径；`get_resume_context` 和 `create_resume_proposal` 通过 `LINKCV_BASE_URL` 回调 FastAPI 的 `/internal/agent/**`，并使用另一枚 Bearer 服务令牌。受限 `read` 使 `resume-diagnosis`、`resume-edit` Skill 能进入 Pi prompt 并按需加载，但不扩大业务数据权限。浏览器 Cookie、供应商 API Key 和数据库凭据都不进入工具参数。Pi 运行时模型来自 FastAPI 统一模型管理中的 `pi_agent` binding，服务每次运行按需取得解密后的短时配置，不提供第二套模型配置页面。

管理员绑定 `pi_agent` 时，FastAPI 保存候选配置版本快照、创建调用记录并在请求期解密凭据，然后通过 `POST /internal/probes` 把模型、地址和 Key 临时交给 Pi。Pi 使用原生 provider 直连供应商，模型必须调用固定的 `linkcv_probe` Tool；只有探针与验证证据成功后才切换 binding，明文凭据不写入响应、日志或持久化 Run。

MySQL 是用户会话、消息、运行、工具审计和修改提案的事实源。FastAPI 在每轮请求中恢复最近对话后交给无状态 Pi 运行，因此容器重启或横向扩容不会丢失产品会话。Pi 侧不得把本地文件或进程内 session 当作业务真值。

Pi 的 SSE 成功响应必须发送 `run.completed`、`run.failed` 或 `run.cancelled` 后才结束；FastAPI 对 HTTP 200 后无终态 EOF 统一补发安全化失败。部署探针从公开的 FastAPI `/api/agent/readiness` 进入，经 `PI_SERVICE_TOKEN` 调 Pi，再由 Pi 以 `LINKCV_INTERNAL_AGENT_TOKEN` 回调 FastAPI 内部 readiness。该探针只验证配置与鉴权，不调用模型供应商，也不返回模型名、API Key 或内部错误详情。

## 调用与信任链

```text
Web --Cookie--> FastAPI --PI_SERVICE_TOKEN--> Pi
                                      |
                                      +--LINKCV_INTERNAL_AGENT_TOKEN--> FastAPI internal tools
FastAPI --decrypt pi_agent binding--> Pi runtime model
MySQL <--sessions/runs/messages/tool calls/proposals--> FastAPI
```

FastAPI 创建不可预测的 `runId` 并把当前用户与简历绑定写入数据库；Pi 的每次内部工具调用只携带该 `runId`。内部接口据此重新校验运行仍为 active，并从数据库解析可信 user/resume，绝不接受 Pi 传入 `user_id`。读取工具返回完整语义简历和 `lock_version`；写工具只创建完整 `ResumeDocumentV1`/`ResumeStyleV1` 提案。用户在 Web 明确确认后，FastAPI 才以提案的基准版本执行乐观锁更新并创建 `reason=agent` 的正式版本；冲突返回 `RESUME_EDIT_CONFLICT`，不自动覆盖。

服务令牌必须是两枚不同的高熵值并只放在 `.env.local`、环境级私密覆盖或 Jenkins 凭据中：`PI_SERVICE_TOKEN` 用于 FastAPI 调 Pi，`LINKCV_INTERNAL_AGENT_TOKEN` 用于 Pi 回调 FastAPI。Production 开启 `AGENT_ENABLED=true` 时缺少任一令牌都会拒绝启动。

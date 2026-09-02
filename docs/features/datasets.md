# 用户资料集功能

## 功能范围

资料集功能允许用户上传 PDF、DOCX、Markdown 和纯文本材料，查看可恢复的异步解析状态和转换后的 Markdown，并在 AI 助手中作为显式上下文引用。上传按用户幂等键防止超时重试产生重复资料，服务端负责格式真实性、大小、速率、并发、数量和容量限制。当前不是通用知识库平台，不提供跨用户共享、文件夹层级、全文检索或 RAG 索引。

接口字段与失败语义见 [HTTP 接口契约](../api/http-contracts.md)，异步处理架构见 [Backend 架构](../internals/backend.md)。

## 用户入口

Web `/datasets` 在选择文件后立即逐个上传；服务端接受的文件直接进入正式列表，未接受项通过顶部单行提示反馈失败原因。列表展示上传时间与 `queued`、`processing`、`succeeded`、`failed` 四种解析状态，支持重命名、失败重试、单个删除和批量删除。未完成或失败的资料不开放内容读取；读取失败保留重试入口。成功内容使用 Markdown 预览，按需渲染 Mermaid，并过滤解析服务写入的分页、表格控制标记。AI 助手只使用用户在当轮显式选择的已完成资料。

## 代码地图

| 层级 | 入口 | 职责 |
| --- | --- | --- |
| HTTP/ORM | `modules/datasets/routes.py`、`models.py`、`schemas.py` | 上传、列表、重试、删除、内容读取与资料元数据 |
| 上传服务 | `services/dataset_upload_service.py` | 文件真实性校验、流式摘要与存储、幂等预留和准入限制 |
| 共用任务 | `modules/resumes/models.py::DocumentParseTask` | 上传和解析状态真值 |
| Worker | `workers/dataset_parse_worker.py`、`document_parse_consumer.py` | 格式分派、转换、MQ 补发、租约恢复和结果收口 |
| 外部适配 | `integrations/document_converter.py`、`linkparse_client.py` | 本地转换与 LinkParse 调用 |
| Web | `features/datasets/` | 自动上传队列、状态列表、批量管理和 Markdown/Mermaid 预览 |
| Agent | `modules/agent/resume_tools.py` | 读取当前用户显式选择的已完成资料 |

## 核心对象与规则

- `user_dataset` 保存用户归属、文件名、格式、MIME、大小、对象键、SHA-256、用户范围的 `idempotency_key`、请求指纹和 `parse_task_id`；同一用户与幂等键只能对应同一份请求。
- 原始文件进入私有对象存储；Worker 本地规范化 Markdown/TXT，通过 LinkParse 解析 PDF/DOCX。
- 解析状态以 `document_parse_tasks` 为真值；资料与任务在同一事务创建。源文件写入成功后任务进入 `queued`，RabbitMQ 发布失败不把上传伪装成失败，由 Worker 定时扫描补发。
- Worker 通过条件更新原子认领 `queued → processing`，`parse_attempt_count` 同时作为尝试版本；重复消息不能重复解析，旧 Worker 的晚到结果不能覆盖新尝试。
- 转换后的 Markdown 只在任务成功且再次通过资料与任务归属校验后返回。
- `parse_task_id` 是跨模块任务引用并受唯一约束保护，但没有数据库外键。

## 扩展边界

新增文件格式需同步服务端真实性校验、Worker 分派、对象存储、前端接受类型和 HTTP 契约。当前删除是终态资料的同步永久删除；`queued` 和 `processing` 资料不可删除。目录树、共享、检索、回收站或异步删除需要新的产品与持久化设计，不能作为当前功能宣称。

## 关键流程

1. Web 从列表响应读取服务端文件限制；每个新选择文件生成稳定幂等键，并独立校验和上传，一个失败不阻断其他文件。
2. HTTP 层规范化文件名，流式计算 SHA-256，验证 PDF、DOCX 或文本真实内容，并在用户锁边界内检查速率、并发、数量和容量。
3. 数据库先创建 uploading 预留；MinIO 成功后在事务中更新为 `upload=succeeded、parse=queued`，再尽力发布 `DatasetParseMessage`。发布失败时接口仍返回已接受资料。
4. Worker 定时补发超时 queued 任务、回收过期 processing 租约或上传预留，并以任务状态和尝试版本防止重复消息及晚到结果产生副作用。
5. 转换成功后写入受控 Markdown 对象并更新终态；失败保存稳定错误码。列表联表返回状态但不暴露对象键和 SHA-256，内容接口再次校验用户、成功状态和转换对象。

## 权限与失败边界

- MinIO 明确失败时上传预留进入失败状态并尽力清理对象；上传租约超时后由 Worker 清理残留预留。对象写入成功但后续数据库提交失败仍按安全错误返回并保留可排查上下文。
- RabbitMQ 发布失败只记录安全日志并保留 `queued`；补发扫描与原子认领负责最终处理。达到最大解析次数后才进入可见失败态，所有者可以显式重试回到 `queued`。
- 所有读取、重命名、重试和删除查询都绑定当前 `user_id + dataset_id`；处理中资料返回稳定冲突，不能通过批量操作绕过。
- 转换对象缺失或读取失败不能回退为源文件内容，也不能把未完成任务标为成功。
- Agent 读取资料时复用同一所有权和完成态判断，不直接读取任意 MinIO 对象。

## 修改联动与验证

修改上传限制、格式、幂等语义、状态或转换对象路径时，需同步后端配置、迁移、Worker、Web API 类型与上传队列、HTTP 契约和开发/部署依赖。主要测试入口为 `test_user_datasets.py`、`test_dataset_upload_service.py`、`test_dataset_parse_worker.py`、`DatasetsPage.test.tsx`、`datasetMarkdown.test.ts` 和 `datasetMermaid.test.ts`，并复用 MySQL 迁移、文档转换与消息消费相关测试。

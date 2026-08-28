# 用户资料集功能

## 功能范围

资料集功能允许用户上传 PDF、DOCX、Markdown 和纯文本材料，查看解析状态和转换后的 Markdown，并在 AI 助手中作为显式上下文引用。当前不是通用知识库平台，不提供跨用户共享、文件夹层级、全文检索或 RAG 索引。

接口字段与失败语义见 [HTTP 接口契约](../api/http-contracts.md)，异步处理架构见 [Backend 架构](../internals/backend.md)。

## 用户入口

Web `/datasets` 提供上传、列表、状态和 Markdown 预览。未完成或失败的资料不开放内容读取；读取失败保留重试入口。AI 助手只使用用户在当轮显式选择的已完成资料。

## 代码地图

| 层级 | 入口 | 职责 |
| --- | --- | --- |
| HTTP/ORM | `modules/datasets/routes.py`、`models.py`、`schemas.py` | 上传、列表、内容读取与资料元数据 |
| 共用任务 | `modules/resumes/models.py::DocumentParseTask` | 上传和解析状态真值 |
| Worker | `workers/dataset_parse_worker.py`、`document_parse_consumer.py` | 格式分派、转换和结果收口 |
| 外部适配 | `integrations/document_converter.py`、`linkparse_client.py` | 本地转换与 LinkParse 调用 |
| Web | `features/datasets/` | 上传、状态列表和 Markdown 预览 |
| Agent | `modules/agent/resume_tools.py` | 读取当前用户显式选择的已完成资料 |

## 核心对象与规则

- `user_dataset` 保存用户归属、文件名、格式、MIME、大小、对象键、SHA-256 和 `parse_task_id`。
- 原始文件进入私有对象存储；Worker 本地规范化 Markdown/TXT，通过 LinkParse 解析 PDF/DOCX。
- 解析状态以 `document_parse_tasks` 为真值；资料与任务在同一事务创建，队列发布失败会把任务收口为失败。
- 转换后的 Markdown 只在任务成功且再次通过资料与任务归属校验后返回。
- `parse_task_id` 是跨模块任务引用并受唯一约束保护，但没有数据库外键。

## 扩展边界

新增文件格式需同步上传校验、Worker 分派、对象存储、前端接受类型和 HTTP 契约。目录树、共享、检索或删除生命周期需要新的产品与持久化设计，不能作为当前功能宣称。

## 关键流程

1. HTTP 层校验扩展名、大小和非空内容，先上传私有原件。
2. 数据库同一事务创建 `UserDataset` 与 `DocumentParseTask`，再发布 `DatasetParseMessage`。
3. Worker 以任务归属和状态防重，转换成功后写入受控 Markdown 对象并更新任务；失败保存稳定失败分类。
4. 列表联表返回资料与任务状态，不暴露对象键和 SHA-256；内容接口再次校验用户、任务成功状态和转换对象。

## 权限与失败边界

- 上传对象成功但数据库事务失败时需要尽力清理原件；队列发布失败必须把任务标为失败并返回错误。
- 转换对象缺失或读取失败不能回退为源文件内容，也不能把未完成任务标为成功。
- Agent 读取资料时复用同一所有权和完成态判断，不直接读取任意 MinIO 对象。

## 修改联动与验证

修改上传限制、格式、状态或转换对象路径时，需同步后端配置、Worker、Web 文件选择、HTTP 契约和开发/部署依赖。主要测试入口为 `test_user_datasets.py`、`test_dataset_parse_worker.py`、`DatasetsPage.test.tsx`，并复用文档转换与消息消费相关测试。

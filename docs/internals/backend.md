# FastAPI 后端

## 当前职责与结构

`apps/backend` 承接健康检查、Cookie 鉴权、语义简历生命周期、历史版本、文件导入和私有对象资源。

| 位置 | 职责 |
| --- | --- |
| `src/linkcv/main.py` | 装配数据库、MinIO、tolink-rag 和结构化模型 Adapter；测试可注入 Fake |
| `src/linkcv/domain/` | `ResumeDocumentV1`、`ResumeStyleV1`、联合快照、SectionIR、Draft 和确定性标准化 |
| `src/linkcv/application/resumes/` | 统一创建、乐观锁保存、版本创建/恢复与事务规则 |
| `src/linkcv/integrations/` | tolink-rag HTTP Adapter 和 OpenAI-compatible JSON Schema 模型 Adapter |
| `src/linkcv/services/resume_import_service.py` | 文件校验、对象上传、Markdown 提取、结构化、统一创建和失败补偿 |
| `src/linkcv/services/storage_cleanup_service.py` | 持久化对象删除任务、即时尝试与后台重试 |
| `src/linkcv/modules/identity/` | 用户模型、注册、登录和当前用户依赖 |
| `src/linkcv/modules/resumes/` | ORM、HTTP DTO、模板/简历/版本/导入/资源路由 |
| `migrations/` | SQL-first Alembic revision；当前 head 为 `0005` |
| `tests/unit/` | 不访问外部资源的快速单元测试 |
| `tests/integration/` | 使用隔离 SQLite、Fake MinIO 和外部服务替身的组合测试 |

## 数据与事务

MySQL 包含 `users`、`resume_templates`、`resumes`、`resume_versions` 和 `storage_cleanup_jobs`。当前可编辑状态保存在 `resumes.data_json/style_json`，历史版本同时快照两份 JSON。由 `0005` 转换过的旧记录还在同一行的 `legacy_data_json_backup/legacy_style_json_backup` 保存迁移前原值，普通新记录保持为 `NULL`，这些备份不通过 HTTP 暴露。HTTP 中的 ID 是十进制字符串，ORM 和数据库使用整数。

所有创建来源都调用统一服务，在单事务中创建当前简历和 initial 版本。自动保存使用 `resume_id + user_id + base_lock_version` 条件更新并递增锁，不创建版本。手动版本与恢复先锁定所属简历；恢复按需生成 `before_restore` 并总是生成 `restore`，版本上限淘汰处于同一事务。

`0003` 将模板外键改为 `ON DELETE SET NULL`，同时允许历史模板来源在模板删除后保留 `source_type=template/template_id=NULL`。MySQL 8.4 禁止 `SET NULL` 外键列参与 CHECK，因此 `ck_resumes_source_fields` 只约束来源证据字段，`template_id/source_type` 组合由统一创建服务保证，外键继续保证非空引用有效。如果已经出现模板来源但 `template_id=NULL` 的记录，0003 downgrade 会拒绝恢复不成立的 RESTRICT/非空来源约束。`0004` 新增不绑定已删除业务记录的 `storage_cleanup_jobs`，以对象键或前缀保存幂等删除任务。`0005` 在批量转换前核对旧节点和样式字段，只接受可完整表达的上一版结构；遇到未知字段、危险 Markdown 或无法保留的内嵌图片会中止。降级先从同行备份恢复 `resumes` 和 `resume_versions`，再删除备份列。已进入共享环境的 revision 不原地修改。

## 导入与外部边界

Markdown 文件直接读取；DOCX/PDF 通过 `RagConverter` 发往 tolink-rag 文件转 Markdown 接口。Markdown 只保存为 `extracted_markdown` 来源证据；超过结构化输入上限的内容不会发送给模型，合规输入的 AST 被压缩为 `SectionIR` 后才发送给结构化模型，模型只能返回 `ResumeExtractionDraft`，最终稳定 ID、日期和来源行号由程序生成。导入入口在单个进程内实施每用户频率、每用户并发和全局并发限制；水平扩容时需由 Redis 或网关提供共享额度。

外部服务未配置时应用仍可启动，但对应导入返回明确错误，不使用 Fake 冒充生产结果。默认测试全部使用确定性 Fake 和 `httpx.MockTransport`，不访问真实网络或读取密钥。日志只记录 operation/resume/user 标识、大小、耗时和错误类型，不记录正文、Prompt、Cookie、密钥或完整供应商响应。

## 对象存储

- 用户级兼容图片：`users/{user_id}/assets/...`。
- 导入原文件：`users/{user_id}/resume-imports/{operation_id}/...`。
- 简历资源：`users/{user_id}/resumes/{resume_id}/assets/...`。

简历级读取先校验所属简历。资源删除会递归检查当前和历史 `data_json` 引用；仍在使用时拒绝删除。数据库与 MinIO 不伪装成分布式事务：导入失败先尝试补偿删除；删除简历则在数据库事务中登记清理任务并于提交后立即尝试。失败任务保存在 `storage_cleanup_jobs`，由应用生命周期内的后台任务持续重试，成功后删除任务记录。

## 测试约定

- `npm run test:backend:unit`：领域、Adapter 和仓库脚本测试。
- `npm run test:backend:integration`：SQLite、Fake MinIO、Fake RAG/LLM 的 HTTP 组合测试。
- `LINKCV_TEST_MYSQL_URL`：仅允许指向本机一次性 `linkcv` 数据库，用于 `0002`–`0005` 往返、旧快照转换和物理约束验证。
- 真实 tolink-rag、模型、MinIO 和浏览器流程不进入默认 CI，需单独授权联调。

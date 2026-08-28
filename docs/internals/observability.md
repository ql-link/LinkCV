# 可观测性与业务审计架构

## 架构职责

可观测性子系统负责请求上下文、结构化系统日志、客户端事件、业务审计和管理员日志查询。它区分系统运行事件与业务操作者行为，不把日志存储当作业务数据库，也不允许浏览器直连 Loki。

接口筛选与返回结构见 [HTTP 接口契约](../api/http-contracts.md)，部署拓扑见 [部署说明](../ops/deployment.md)。

## 组件入口

- `modules/observability/middleware.py`：request ID、actor、target、结果和响应审计状态。
- `logging.py`：结构化 JSONL 事件输出。
- `audit.py`：固定审计动作目录和请求上下文绑定。
- `loki.py`：面向固定筛选条件的共享 Loki 查询适配。
- `routes.py`：受限客户端事件写入与管理员日志读取。
- Web `ObservabilityBoundary.tsx`：捕获客户端异常；`AdminObservabilityPanels.tsx`：系统和审计日志界面。

## 数据流

中间件建立请求上下文，身份依赖绑定 actor，业务路由在通过归属检查后绑定 target，响应完成时输出成功或受控失败事件。Promtail 采集容器 JSONL 并写入共享 Loki；管理端只经 FastAPI 使用固定字段、时间窗口和游标查询。

LLM 调用日志保存在 MySQL，由 [Agent/LLM 运行时](agent-runtime.md) 管理；本子系统不复制模型计量。审计内容必须排除 Cookie、token、模型密钥、简历正文和文件内容等敏感数据。

## 事件与存储边界

| 类型 | 产生位置 | 存储/查询 | 用途 |
| --- | --- | --- | --- |
| 请求与系统日志 | FastAPI/Worker logger | JSONL → Promtail → Loki | 故障定位、依赖和 request ID 关联 |
| 业务审计 | 中间件 + 业务路由绑定 | JSONL → Loki | 操作者、动作、目标和结果追踪 |
| Web 客户端事件 | 受限上报接口 | 结构化日志链 | 浏览器异常与兼容事件 |
| LLM 调用日志 | `modules/llm` | MySQL | 模型、状态、Token、成本和验证证据 |

request ID 是跨日志关联键，不是用户身份；actor 只能来自已验证会话或成功登录结果，target 只能来自路由参数与通过归属校验的业务实体。

## 故障与降级

- 本地日志 sink 失败会通过响应审计状态暴露，但不能改变已成功业务事务的 HTTP 结果。
- Loki 未配置或查询失败不影响普通业务 API；管理端日志接口返回受控失败，不绕过 FastAPI 直连 Loki。
- 查询遇到部分脏行时返回可用记录和脏行提示，游标仍基于受控排序推进。
- 客户端事件上报受大小、字段和动作限制，不能成为任意日志注入通道。

## 扩展边界

新增审计动作时同步固定动作目录、业务路由、筛选 schema、管理端选项和 HTTP 契约。新增日志标签时还要核对 Promtail、Loki 查询和部署配置，避免产生无界高基数字段。

## 修改联动与验证

修改上下文字段、审计动作或查询标签时，需同步 `middleware/audit/logging/loki/schemas`、管理端筛选、Promtail 配置、部署文档和接口契约。主要验证入口为 `test_observability.py`、`modules/observability/test_logging.py`、`test_loki.py`、管理端 `AdminObservabilityPanels` 测试和运行时契约检查。

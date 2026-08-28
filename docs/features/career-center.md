# 求职中心功能

## 功能范围

求职中心覆盖岗位导入、一次求职记录、阶段推进、面试排期、面试复盘和素材。岗位资料可被多次求职记录复用；一次 `JobApplication` 才是完整求职生命周期的聚合根。前台主流程以求职记录为入口，岗位资料和单场复盘作为记录的关联能力呈现。

字段、状态动作和错误语义见 [HTTP 接口契约](../api/http-contracts.md)，浏览器采集能力见 [浏览器插件架构](../internals/extension.md)。

## 用户入口

- `/career/applications`：求职记录列表、六阶段只读看板、岗位导入和记录详情，是求职中心默认入口。
- `/career/schedule`：面试排期。
- `/career/applications/:id`：单条求职记录的进度、岗位快照、面试轮次和求职信息；附带 `session` 查询参数时进入对应面试复盘。
- `/career/jobs`：保留岗位列表、搜索、创建、智能导入、详情、编辑、删除和插件能力，不再作为求职中心主导航。
- `/career/reviews`、旧 `/jobs/*` 与 `/interviews` 保留兼容能力，规范主入口统一位于 `/career/applications` 和 `/career/schedule`。

## 代码地图

| 层级 | 入口 | 职责 |
| --- | --- | --- |
| 岗位 HTTP/ORM | `modules/job_descriptions/` | 岗位模型、schema、搜索、CRUD 与导入路由 |
| 岗位应用服务 | `application/job_descriptions/` | 创建、重复解决、来源清洗和文字/图片草稿 |
| 求职 HTTP/ORM | `modules/interviews/` | 进程、排期、复盘、素材模型与路由 |
| 求职状态机 | `application/interviews/state.py`、`service.py` | 阶段动作、冲突校验和事务 |
| Web | `features/jobs/`、`features/interviews/` | 岗位导入与维护、求职记录、排期和记录内复盘界面 |
| 插件 | `apps/extension` | BOSS 页面采集、用户确认和岗位导入调用 |

## 核心对象与规则

- `job_descriptions` 保存用户私有的结构化岗位和来源身份；删除岗位会释放来源唯一键，但不会删除既有求职历史。
- `job_applications` 保存岗位快照、可选正式简历版本快照、当前阶段、结果、归档状态与乐观锁。
- `interview_sessions` 同时承载单场排期和复盘，约束阶段、轮次、时间、状态和结果组合。
- `interview_assets` 保存面试录音、视频或文档的对象元数据，文件访问继续校验所属求职进程。
- 创建面试必须先存在岗位和求职进程，不能产生孤立排期；阶段动作只能由后端状态机执行。

## 依赖边界

该功能依赖身份、简历正式版本、统一 LLM、对象存储和审计。浏览器插件只负责提交用户确认后的岗位采集字段；AI 助手可把岗位、求职进程和复盘作为只读上下文，但不能代替求职中心写阶段状态。

## 关键流程

### 岗位进入系统

- 手工创建直接走统一创建服务。
- 文字/图片智能导入只生成待确认草稿；用户确认后才创建岗位，原始输入和模型正文不落库。
- 插件导入先清洗页面字段、规范化来源 URL 和站点身份，再复用相同创建与重复解决事务，不调用 LLM。

### 求职与面试

1. 用户导入或选择岗位后创建一次求职记录，可选某个正式简历版本，初始进入筛选阶段。
2. 求职记录默认以列表展示公司、岗位、当前进度、下一阶段、最近面试和更新时间，也可切换为“待投递、筛选中、测评中、面试中、等待通知、已结束”六阶段只读看板。
3. 阶段动作由后端状态机更新当前阶段、轮次、状态和结果；看板不直接修改流程状态，客户端也不能写入任意状态组合。
4. 面试排期绑定求职记录并校验时间范围和冲突；完成、取消、题目、总结和素材都归入对应求职记录下的 `InterviewSession`。
5. 素材先校验记录所有权，再保存对象与元数据；读取和删除继续通过 session→application→user 链路授权。

## 一致性与失败边界

- 删除岗位只解除求职进程的来源外键，已保存的岗位和简历快照必须继续可读。
- 创建、阶段动作、排期移动和复盘更新使用 `lock_version` 或幂等请求边界，冲突时不覆盖较新的服务端状态。
- LLM、对象存储或插件采集失败不能生成部分岗位、孤立素材或虚假求职阶段。
- 新增阶段、结果、颜色或素材类型必须同步数据库 CHECK、应用状态机、schema、前端映射和接口契约。

## 修改联动与验证

岗位来源契约变化还需同步插件 `contracts.ts`、Manifest 权限和导入测试；求职状态变化需同步列表、六阶段看板、记录详情、排期、复盘和 Agent 上下文。主要验证入口为后端 `test_job_descriptions.py`、`test_interviews.py`、`test_job_description_import.py`、`test_interview_state.py`，以及 Web `JobCenterPage`、`JobDetailPage`、`JobFormPage`、`JobSmartImportDialog` 和 `InterviewCenterPage` 测试。

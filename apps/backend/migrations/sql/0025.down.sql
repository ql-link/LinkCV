-- Restore the 0024 sample only when the current row still contains the 0025 content.
UPDATE resume_templates
SET data_json = IF(
  JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.basics.headline')) <=> '平台工程师'
    AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.basics.location')) <=> '成都'
    AND SHA2(JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.sections.custom_sections[0].items[0].content.content')), 256)
      = 'dfde26baa5f427f693be289ca8d829676fbfe723b86b6c222ca6a1f598d49021',
  JSON_SET(
    data_json,
    '$.basics.headline', '后端开发工程师',
    '$.basics.location', '杭州',
    '$.sections.custom_sections[0].items[0].content.content', '# 张三

电话：13800000000 ｜ 邮箱：zhangsan@example.com ｜ 个人网站：www.example.com

## 教育经历

::: left
示例理工大学 - 计算机科学与技术学院 - 人工智能
:::

::: right
2022.09 - 2026.06
:::

## 专业技能

1. AI：熟悉主流 AI 编程工具，能够使用编程 Agent 完成需求分析、编码、测试与文档整理。
2. Java：熟悉 Java 基础知识、面向对象思想及 Spring IOC、AOP 等框架原理。
3. 并发编程：掌握 JMM、volatile、线程池及 AQS 的核心设计思想。
4. JVM：熟悉内存模型、类加载机制、垃圾回收算法与常见问题排查方法。
5. Redis：熟悉常用数据结构、缓存高并发问题、持久化机制与内存淘汰策略。
6. MySQL：掌握事务、索引与日志机制，能够结合执行计划分析常见性能问题。
7. 消息队列：了解 Kafka、RabbitMQ 的应用场景及消息可靠性方案。

## 实习经历

::: left
星河云科技有限公司
:::

::: right
Java 开发实习生 ｜ 2025.07 - 2025.12
:::

技术架构：*Java、MySQL、Redis、Spring Boot、MyBatis、Kafka*

工作介绍：参与企业销售协同平台后端研发，负责预测管理、数据同步及公共服务能力建设。

1. 设计销售预测版本管理链路，支持分阶段确认、历史追溯和多维度数据汇总。
2. 建设统一命令行工具，将自然语言操作转换为标准命令并输出结构化结果。
3. 接入内部业务系统公共工具服务，沉淀可复用流程并完善权限与审计边界。

::: left
青舟数据服务有限公司
:::

::: right
后端开发实习生 ｜ 2024.11 - 2025.04
:::

技术架构：*Java、PostgreSQL、Redis、Spring Boot、Elasticsearch、MinIO*

工作介绍：参与企业知识库与文档检索平台建设，负责检索链路优化和文件管理模块开发。

1. 构建文档元数据标签体系，支持按业务属性精确筛选目标内容。
2. 实现文档增量同步与失败恢复机制，提升数据更新效率和链路稳定性。
3. 优化关键词检索和条件过滤逻辑，完善接口错误码、日志与测试用例。

::: left
远山智联科技有限公司
:::

::: right
Java 开发实习生 ｜ 2024.05 - 2024.09
:::

技术架构：*Java、MySQL、Redis、RabbitMQ、Spring Boot、MyBatis*

工作介绍：参与物联网监测平台开发，建设消息中台与分层告警流程，支撑实时数据处理和异常追踪。

::: left
云杉信息技术有限公司
:::

::: right
后端开发实习生 ｜ 2023.11 - 2024.03
:::

技术架构：*Java、MySQL、Redis、XGBoost、Spring Boot、MyBatis*

工作介绍：负责校园服务项目的定价与订单模块，完成热度预测、信用评价及相近订单合并能力。

## 开源经历及个人作品

::: left
KnowledgeFlow
:::

::: right
github.com/example/knowledge-flow
:::

技术架构：*Python、Java、MySQL、Qdrant、Elasticsearch、Redis*

项目描述：从零构建的知识检索系统，提供文档解析、结构化分片、混合检索、结果重排及流式问答能力。

1. 抽取项目级文档框架作为 Agent 上下文入口，并按查询动态加载相关资料。
2. 实现标题结构粗分与向量语义精分结合的分片策略，增强长文档语义完整性。
3. 设计解析状态流转与版本记录，支持失败重试、断点恢复和结果追溯。
4. 构建声明式 DAG 流程编排能力，支持节点并发、依赖恢复与失败重试。
5. 搭建稠密、稀疏与关键词多路召回及重排流程，持续优化检索效果。
6. 建设覆盖清洗、分片、召回、重排和生成的离线评测体系。'
  ),
  NULL
)
WHERE `key` = 'classic-technical-cn';

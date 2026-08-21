-- Replace the original sample with a wholly fictional platform-engineering profile.
-- The digest guard prevents overwriting locally customized template content.
UPDATE resume_templates
SET data_json = IF(
  JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.basics.headline')) <=> '后端开发工程师'
    AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.basics.location')) <=> '杭州'
    AND SHA2(JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.sections.custom_sections[0].items[0].content.content')), 256)
      = 'fcf53019f18fea20f7e5dd3cafb8900b7955fb360161a3faf3c5297644b57736',
  JSON_SET(
    data_json,
    '$.basics.headline', '平台工程师',
    '$.basics.location', '成都',
    '$.sections.custom_sections[0].items[0].content.content', '# 张三

电话：13800000000 ｜ 邮箱：zhangsan@example.com ｜ 个人网站：www.example.com

## 教育经历

::: left
北辰科技大学 - 信息工程学院 - 软件工程
:::

::: right
2021.09 - 2025.06
:::

## 专业技能

1. Go：能够使用 Gin、gRPC 与 context 构建服务，重视错误处理、接口边界和可测试性。
2. TypeScript：熟悉 React 组件设计、状态管理与浏览器性能分析，可独立完成中后台功能。
3. 云原生：掌握 Docker、Kubernetes、Helm 的常见实践，能够编写部署清单和健康检查。
4. 可观测性：熟悉 OpenTelemetry、Prometheus 与 Grafana，能够围绕指标、日志和链路定位问题。
5. PostgreSQL：了解执行计划、复合索引、分区表与慢查询分析，能根据访问模式调整数据结构。
6. 工程质量：习惯通过单元测试、契约测试和端到端测试保护核心流程，并维护可重复的测试数据。
7. 自动化交付：能够使用 GitHub Actions 与 Terraform 建立构建、发布和基础设施变更流程。

## 实习经历

::: left
极昼气象服务有限公司
:::

::: right
平台开发实习生 ｜ 2024.07 - 2024.12
:::

技术环境：*Go、gRPC、PostgreSQL、OpenTelemetry、Kubernetes*

职责概述：参与气象观测数据平台建设，负责采集链路治理、站点状态诊断和运行数据可视化。

1. 统一三类观测设备的数据协议与时间字段，建立异常值隔离和重放流程，降低脏数据对下游计算的影响。
2. 为跨服务调用补充 Trace 与关键业务指标，制作站点健康仪表盘，缩短采集延迟问题的定位时间。
3. 编写容量压测工具与降级演练脚本，验证突发数据量下的限流、排队和恢复行为。

::: left
弦月创意工具有限公司
:::

::: right
Web 工程实习生 ｜ 2024.01 - 2024.05
:::

技术环境：*TypeScript、React、WebSocket、IndexedDB、Playwright*

职责概述：参与多人插画编辑器研发，聚焦素材管理、离线编辑和协作状态展示。

1. 完成素材版本面板与差异预览，支持设计稿回退、备注检索和批量归档。
2. 设计弱网下的本地操作队列，在恢复连接后按顺序提交并提示冲突，减少编辑结果丢失。
3. 补充关键协作路径的浏览器测试，覆盖断线重连、只读权限和多人同时编辑场景。

::: left
青屿城市服务有限公司
:::

::: right
云平台实习生 ｜ 2023.07 - 2023.10
:::

技术环境：*Kubernetes、Helm、Terraform、Prometheus、Bash*

职责概述：协助维护城市照明巡检系统的测试环境与发布流程，保障多区域演示环境稳定可用。

1. 将重复的环境配置整理为 Helm Chart，并通过参数校验避免区域标识和域名配置错误。
2. 建立证书到期、任务积压和节点容量告警，配套故障手册与值班交接清单。

## 开源经历及个人作品

::: left
TraceHarbor
:::

::: right
github.com/example/trace-harbor
:::

技术环境：*Go、TypeScript、ClickHouse、OpenTelemetry、Prometheus*

项目描述：面向学习与故障演练的本地可观测性实验台，可导入脱敏后的 Trace、Log 与 Metric 样本，回放历史流量并验证告警规则。

1. 实现 OpenTelemetry 数据接收与字段归一化，支持按服务、环境和采样策略组织实验数据。
2. 设计 ClickHouse 分区与 TTL 策略，在保留近期明细的同时自动清理过期样本。
3. 开发历史流量回放器，可调整速率、注入延迟并记录每次实验的参数与结果。
4. 构建告警规则模拟器，在启用规则前展示命中区间、噪声比例和阈值变化影响。
5. 实现 Trace 时间线与服务拓扑视图，帮助定位长耗时区段和异常调用关系。
6. 建立固定样本生成器与契约测试，并通过自动化流水线发布多平台命令行程序。'
  ),
  NULL
)
WHERE `key` = 'classic-technical-cn';

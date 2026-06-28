export const defaultResumeMarkdown = `# 张三

电话：13800000000 ｜ 邮箱：zhangsan@example.com ｜ 博客：blog.example.com

## 教育经历

::: left
示例大学 - 计算机学院 - 软件工程
:::

::: right
2022.9 - 2026.6
:::

## 实习经历

::: left
星河云科技有限公司
:::

::: right
Java 开发实习生
:::

**技术架构：** Java、MySQL、Redis、SpringBoot、MyBatis

**工作介绍：** 参与企业内部协同平台的后端开发，负责用户权限、任务流转、数据统计等模块的接口设计与功能实现。

1. 设计任务状态流转接口，统一参数校验、权限判断和异常返回，减少重复业务判断。
2. 使用 Redis 缓存高频配置数据，降低数据库重复查询压力。
3. 配合前端联调列表筛选、详情编辑和批量操作能力，完善接口文档与测试用例。

::: left
青舟数据服务有限公司
:::

::: right
Java 开发实习生
:::

**技术架构：** Java、PostgreSQL、Redis、SpringBoot、MyBatis、Elasticsearch、MinIO

**工作介绍：** 参与文档管理与检索平台建设，负责文件上传、元数据管理、搜索筛选等基础能力开发。

1. 接入对象存储完成附件上传、预览地址生成和删除清理流程。
2. 基于 Elasticsearch 实现关键词检索和条件过滤，提升列表查询体验。
3. 梳理接口错误码和日志字段，方便问题定位和后续维护。

## 开源经历及个人作品

::: left
TaskFlow Lite
:::

::: right
全栈开发者
:::

**技术架构：** React、TypeScript、Node.js、SQLite、Express

**项目描述：** 一个用于个人任务整理和周报生成的轻量级 Web 工具，支持任务分组、状态追踪和 Markdown 导出。

1. 使用 Zustand 管理任务、筛选条件和编辑状态，保持页面交互简洁。
2. 设计本地 SQLite 数据结构，支持任务归档和按周统计。
3. 增加 Markdown 导出能力，便于复盘和同步到团队文档。

## 专业技能

1. Java：熟悉 Java 基础知识、集合、多线程、Spring、MyBatis 等常用框架。
2. 数据库：了解 MySQL、PostgreSQL 的索引、事务和常见查询优化方式。
3. 中间件：熟悉 Redis 常见缓存模式和基础队列使用场景。
4. 前端协作：能够阅读 React + TypeScript 项目，完成接口联调和问题定位。
5. 工程能力：重视可维护性、可测试性与清晰的模块边界。`;

export const defaultResumeSettings = {
  fontFamily: '"Source Han Serif SC", "Songti SC", STSong, SimSun, serif',
  fontSize: 10.5,
  lineHeight: 1.32,
  pageMargin: 16,
  verticalPageMargin: 16,
  theme: "classic",
  smartOnePage: false,
  showSource: false,
};

DEFAULT_RESUME_MARKDOWN = """# 张三

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

**技术架构：** Java、MySQL、Redis、Spring Boot、MyBatis

**工作介绍：** 参与企业内部协同平台的后端开发，负责用户权限、任务流转和数据统计等模块。

1. 设计任务状态流转接口，统一参数校验、权限判断和异常返回。
2. 使用 Redis 缓存高频配置数据，降低数据库重复查询压力。
3. 配合前端联调列表筛选、详情编辑和批量操作能力。

## 开源经历及个人作品

::: left
TaskFlow Lite
:::

::: right
全栈开发者
:::

**技术架构：** React、TypeScript、Python、FastAPI、MySQL

**项目描述：** 一个用于个人任务整理和周报生成的轻量级 Web 工具。

1. 使用 Zustand 管理任务、筛选条件和编辑状态。
2. 设计清晰的数据结构，支持任务归档和按周统计。
3. 增加 Markdown 导出能力，便于复盘和团队协作。

## 专业技能

1. Java：熟悉 Java 基础知识、集合、多线程和常用开发框架。
2. 数据库：了解 MySQL 的索引、事务和常见查询优化方式。
3. 工程能力：重视可维护性、可测试性与清晰的模块边界。"""


DEFAULT_RESUME_SETTINGS = {
    "fontFamily": '"Source Han Serif SC", "Songti SC", STSong, SimSun, serif',
    "fontSize": 10.5,
    "lineHeight": 1.32,
    "pageMargin": 16,
    "verticalPageMargin": 16,
    "theme": "classic",
    "smartOnePage": False,
    "showSource": False,
}

-- Restore the exact 0026 official template snapshots only when 0027 content is still intact.

UPDATE resume_templates
SET data_json = IF(
  SHA2(JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.sections.custom_sections[0].items[0].content.content')), 256)
    = 'dd2c3c96eda00fa319459842ff9a7e1ad22752fe9da18c7d544c47979fc96dc1',
  JSON_SET(
    data_json,
    '$.sections.custom_sections[0].items[0].content.content', ':::: sidebar
![虚构头像](/templates/avatar-administrative.svg "linkcv-avatar:108")

### 基本信息

:icon[Calendar]: 24 岁

:icon[MapPin]: 上海

:icon[Briefcase]: 3 年经验

:icon[Phone]: 13800000000

:icon[Mail]: zhangsan@example.com

### 核心能力

**语言能力：** 英语六级，可进行日常商务沟通与材料整理。

**办公能力：** 熟练使用文档、表格与演示工具，能够搭建行政台账。

**协作能力：** 善于跨部门沟通，能够推进会议、采购与活动事项。

### 能力指数

- 行政统筹
- 数据整理

### 兴趣爱好

- 阅读
- 徒步
- 摄影
::::

:::: main
# 张三

行政专员

::: left
求职方向：行政专员　期望薪资：面议
:::

::: right
意向城市：上海　到岗时间：两周内
:::

## :icon[GraduationCap]: 教育背景

::: left
2020.09 - 2024.06　**北辰商学院**
:::

::: right
工商管理（本科）
:::

**专业成绩：** GPA 3.7 / 4.0（专业前 10%）

**主修课程：** 管理学、组织行为学、人力资源管理、统计学、商务沟通与办公自动化。

## :icon[Briefcase]: 工作经历

::: left
2024.07 - 至今　**云杉商务服务有限公司**
:::

::: right
行政专员
:::

- 维护会议、采购、合同与固定资产台账，确保资料完整并可追溯。
- 统筹月度员工活动与访客接待，协调供应商、场地和内部资源。
- 优化常用申请表与归档规范，减少重复沟通并提升流转效率。

::: left
2023.07 - 2024.06　**知行文创有限公司**
:::

::: right
行政助理
:::

- 协助安排会议日程、整理纪要并跟进待办事项。
- 负责办公用品盘点、采购登记和费用凭证整理。
- 配合招聘预约与入职材料核验，维护员工基础信息。

## :icon[Award]: 荣誉证书

- 全国计算机等级考试二级，熟练使用常用办公软件。
- 校级优秀志愿服务个人，具备活动组织与现场协调经验。

## :icon[Star]: 自我评价

做事细致有条理，重视时间节点和信息准确性；能够主动拆解任务、协调资源并及时反馈风险，在多任务环境中保持稳定执行。
::::'
  ),
  NULL
)
WHERE `key` = 'administrative-sidebar-cn';

UPDATE resume_templates
SET data_json = IF(
  SHA2(JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.sections.custom_sections[0].items[0].content.content')), 256)
    = '06eab3e2880a3ed4c065350218a692dbe6b725d81d3882289fb5e04f34d37355',
  JSON_SET(
    data_json,
    '$.sections.custom_sections[0].items[0].content.content', '![虚构头像](/templates/avatar-campus.svg "linkcv-avatar:82")

# 张三｜校招 / 社招通用简历

13800000000 ｜ zhangsan@example.com ｜ 杭州

## 教育背景

:::: meta
2020.09 - 2024.06
北辰财经大学
市场营销 · 本科
GPA 3.8 / 4.0
::::

- **研究实践：** 参与区域消费趋势调研，负责问卷清洗、数据分析与结论汇报。
- **相关课程：** 市场营销、消费者行为、统计学、电子商务、数据可视化。

## 实习经历

:::: meta
2023.06 - 2023.09
星野零售科技有限公司
用户运营
运营实习生
::::

- 维护商品信息与活动排期，协同设计、客服和供应链完成日常上线检查。
- 分析访问、收藏与购买漏斗，提出页面与触达优化建议，支持周度复盘。
- 参与年度主题活动策划，负责会场信息核验、用户引导和效果数据整理。

:::: meta
2022.07 - 2022.10
澄海内容科技有限公司
内容社区
运营实习生
::::

- 完成内容审核、选题整理与用户互动，维护社区内容质量。
- 根据阅读完成率和互动数据调整发布节奏，沉淀可复用的选题清单。
- 协助执行线上征集活动，跟踪报名、发布和复盘全流程。

## 校园经历

:::: meta
2022.03 - 2022.11
北辰大学商学院
创新营销竞赛
团队负责人
::::

- 组织五人团队完成需求拆解、市场调研、方案设计和现场答辩。
- 回收并清洗 520 份有效问卷，形成目标人群与渠道偏好分析。
- 通过阶段评审和数据复盘迭代方案，最终获得校级一等奖。

:::: meta
2021.03 - 2021.12
学生媒体中心
新媒体运营项目
项目成员
::::

- 负责每周内容策划、排期和发布，持续优化标题与互动方式。
- 建立月度数据看板，帮助团队识别高互动内容并调整栏目结构。

## 技能证书 / 其他

- **语言：** 英语六级，可阅读和撰写常用英文材料。
- **工具：** Excel、PowerPoint、Photoshop、SPSS、XMind、Visio。'
  ),
  NULL
)
WHERE `key` = 'campus-professional-cn';

UPDATE resume_templates
SET data_json = IF(
  SHA2(JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.sections.custom_sections[0].items[0].content.content')), 256)
    = '29085dbdf79448169df2859d5bfe9ca3c1bc43c82839d629dcd2f6f597ee6f04',
  JSON_SET(
    data_json,
    '$.sections.custom_sections[0].items[0].content.content', '![虚构头像](/templates/avatar-civic.svg "linkcv-avatar:94")

# 张三｜行政事务专员

13800000000 ｜ zhangsan@example.com ｜ 24 岁 ｜ 江西南昌

## 教育经历

::: left
**南岭财经大学**

工商管理 / 本科 / GPA 3.8
:::

::: right
2020.09 - 2024.06
:::

- 主修课程：管理学、行政管理、人力资源管理、会计学、信息系统管理。
- 获学院年度学习进步奖，并参与校园公共服务调研。

## 实习经历 / 社会实践

::: left
**青禾社区服务中心**

行政事务实习生
:::

::: right
2023.06 - 2023.09
:::

- 处理文件登记、来访接待和服务事项分流，保持台账及时完整。
- 整理会议纪要和活动材料，跟进跨岗位待办并反馈完成情况。
- 熟悉基层服务流程，协助优化常用表单与材料归档方式。

::: left
**晨光公益课堂**

志愿者
:::

::: right
2022.07 - 2022.08
:::

- 与团队共同设计阅读与写作课程，为小学生提供暑期公益辅导。
- 负责课堂签到、家长沟通和学习反馈，所在团队获评优秀志愿团队。

## 自我评价

- 工作细心，责任心强，能够准确理解任务并及时反馈进展。
- 具备良好的文字整理、语言表达和跨岗位沟通能力。
- 服务意识强，能在多任务环境中合理安排优先级。

## 技能 / 证书其他

- **技能：** SPSS、Excel 数据透视表、PowerPoint 信息排版。
- **证书：** 全国计算机等级考试二级。
- **语言：** 英语六级。
- **兴趣：** 阅读、写作与城市徒步。

## 致谢

感谢您阅读这份简历，期待有机会进一步交流。'
  ),
  NULL
)
WHERE `key` = 'civic-service-cn';

UPDATE resume_templates
SET data_json = IF(
  SHA2(JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.sections.custom_sections[0].items[0].content.content')), 256)
    = 'deb416bb8084669b3a604d2b966a359ade170bfab9b6efd742bfaad3cbe037f2',
  JSON_SET(
    data_json,
    '$.sections.custom_sections[0].items[0].content.content', '![虚构头像](/templates/avatar-creative.svg "linkcv-avatar:112")

# 张三｜UI 设计师

:icon[MapPin]: 浙江杭州 ｜ :icon[Mail]: zhangsan@example.com ｜ 2024 届

## :icon[GraduationCap]: 教育经历

::: left
**海岚艺术大学**　视觉传达设计（硕士）　GPA 3.8 / 4.0
:::

::: right
2021.09 - 2024.06
:::

::: left
**南山商学院**　数字媒体艺术（学士）　GPA 3.7 / 4.0
:::

::: right
2017.09 - 2021.06
:::

## :icon[Code2]: 个人技能

:::: trio
**技能名称：** Photoshop
**使用时长：** 5 年
**熟练程度：** 精通
::::

:::: trio
**技能名称：** Figma
**使用时长：** 4 年
**熟练程度：** 熟练
::::

:::: trio
**技能名称：** After Effects
**使用时长：** 3 年
**熟练程度：** 熟练
::::

## :icon[Briefcase]: 工作经历

::: left
**知见数字科技有限公司｜UI 设计师｜杭州**
:::

::: right
2023.07 - 至今
:::

1. 负责电商平台首页、专题活动和关键交易页面的视觉设计与迭代。
2. 建立商品素材规范与组件模板，提高常用页面的设计交付效率。
3. 完成图片精修、信息排版和多尺寸推广素材适配。
4. 与产品、研发和运营协作，根据数据与反馈持续优化方案。

## :icon[Award]: 项目经历

**星图商家工作台**

- **项目简介：** 面向零售商家的经营管理平台，覆盖商品、订单、会员和经营分析。
- **工作内容：**
  1. 梳理角色权限与高频任务，设计桌面端信息架构和关键操作流程。
  2. 建立表格、筛选器、数据卡片和图表组件规范，统一交互状态。
  3. 使用可用性测试验证导航与查询方案，降低新用户完成任务的理解成本。
  4. 与前端共同核对组件边界和响应式规则，跟进设计验收与上线复盘。

## :icon[Star]: 自我评价

热爱视觉与交互设计，能够从业务目标和用户任务出发组织信息；重视设计规范、交付细节与团队协作，善于通过反馈和数据持续迭代。'
  ),
  NULL
)
WHERE `key` = 'creative-orange-cn';

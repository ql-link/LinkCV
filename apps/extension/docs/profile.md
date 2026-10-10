# JSON 简历字段说明

后端投影和插件按下面的字段读取简历。没有的字段直接省略；示例见 `src/autofill/profile/sample-profile.json`。

- 标注“数组”的分组写成数组，最近的经历放在最前面。
- 日期写 `YYYY-MM` 或 `YYYY-MM-DD`；仍在进行的写 `至今`。插件会按页面要求转换成年、月或其他格式。
- `intent.cities` 等可以写字符串数组：下拉框取第一项，文本框用顿号拼接。
- 布尔值会写成“是/否”。
- 学生没有工作经历时，“工作经历”栏位会使用实习经历，反之亦然。
- 本文由 `src/autofill/profile/keys.ts` 整理，新增字段时两处同步。

## basics · 基本信息

| 字段 | 含义与常见说法 |
|---|---|
| `name` | 姓名；中文姓名；真实姓名；full name; name |
| `firstName` | 名；名字；英文名；拼音名；first name; given name |
| `lastName` | 姓；姓氏；拼音姓；last name; surname; family name |
| `firstNameZh` | 中文名字（不含姓）；名-中文 |
| `lastNameZh` | 中文姓氏；姓-中文 |
| `preferredName` | 常用名；昵称；英文昵称；preferred name; nickname |
| `gender` | 性别；男女；gender; sex |
| `birthDate` | 出生日期；生日；出生年月；date of birth; birthday |
| `ethnicity` | 民族；ethnicity |
| `nationality` | 国籍；nationality; citizenship |
| `maritalStatus` | 婚姻状况；婚否；marital status |
| `politicalStatus` | 政治面貌；党员；团员；political status |
| `idType` | 证件类型；身份证件类型；ID type |
| `idNumber` | 证件号码；身份证号；护照号；ID number; passport number |
| `hukou` | 户口所在地；户籍；户籍所在地；household registration |
| `hometown` | 籍贯；老家；生源地；native place; hometown |
| `gaokaoOrigin` | 高考生源地；高考所在省份 |
| `heightCm` | 身高（厘米）；height |
| `weightKg` | 体重（公斤）；weight |
| `age` | 年龄；age |
| `englishName` | 英文名；English name |

## contact · 联系方式

| 字段 | 含义与常见说法 |
|---|---|
| `phone` | 手机号码；手机；联系电话；移动电话；mobile phone; phone number |
| `altPhone` | 备用电话；其他联系电话；alternative phone |
| `emergencyPhone` | 紧急联系人电话；emergency contact phone |
| `dialCode` | 国家或地区电话区号；国际区号；country code; dial code |
| `email` | 电子邮箱；邮箱；email address |
| `city` | 现居城市；所在城市；当前所在地；current city; current location |
| `address` | 通讯地址；家庭住址；详细地址；address line |
| `country` | 国家/地区；居住国家；country |
| `wechat` | 微信号；WeChat ID |
| `qq` | QQ号 |
| `postcode` | 邮政编码；邮编；postal code |
| `emergencyName` | 紧急联系人姓名；emergency contact name |

## education · 教育经历（数组）

| 字段 | 含义与常见说法 |
|---|---|
| `school` | 学校名称；毕业院校；就读学校；大学；school; university; college |
| `major` | 专业；所学专业；专业名称；major; field of study |
| `degree` | 学历；最高学历；学历层次；本科/硕士/博士；education level |
| `degreeTitle` | 学位；学士/硕士/博士学位；degree |
| `enrollDate` | 入学时间；教育经历开始时间；就读开始日期；start date of study |
| `gradDate` | 毕业时间；教育经历结束时间；预计毕业日期；graduation date; end date of study |
| `gpa` | GPA；绩点；平均学分绩点；grade point average |
| `rank` | 成绩排名；专业排名；class rank |
| `trainingMode` | 培养方式；学习形式；全日制/非全日制；study mode |
| `studentNumber` | 学号；student ID |
| `city` | 学校所在城市；school location |
| `courses` | 主修课程；核心课程；courses |
| `advisor` | 导师姓名；supervisor |

## internship · 实习经历（数组）

| 字段 | 含义与常见说法 |
|---|---|
| `company` | 实习单位；实习公司；internship company |
| `title` | 实习岗位；实习职位；internship position |
| `startDate` | 实习开始时间；internship start date |
| `endDate` | 实习结束时间；internship end date |
| `summary` | 实习内容；实习职责；internship description |
| `salary` | 实习薪资；internship salary |
| `department` | 实习部门 |

## work · 工作经历（数组）

| 字段 | 含义与常见说法 |
|---|---|
| `company` | 工作单位；公司名称；雇主；employer; company |
| `title` | 职位名称；职位；岗位；职务；job title; position |
| `startDate` | 工作开始时间；入职时间；工作经历开始日期；employment start date |
| `endDate` | 工作结束时间；离职时间；工作经历结束日期；employment end date |
| `summary` | 工作内容；工作职责；工作描述；job responsibilities; description |
| `salary` | 当前薪资；目前薪资；税前月薪；current salary |
| `city` | 工作地点；工作城市；work location |
| `department` | 所在部门；department |
| `reportTo` | 汇报对象；直属上级；reports to |
| `leaveReason` | 离职原因；reason for leaving |

## projects · 项目经历（数组）

| 字段 | 含义与常见说法 |
|---|---|
| `name` | 项目名称；project name |
| `role` | 项目角色；项目职责；担任职务；project role |
| `description` | 项目描述；项目内容；project description |
| `startDate` | 项目开始时间；project start date |
| `endDate` | 项目结束时间；project end date |
| `link` | 项目链接；project URL |

## awards · 获奖（数组）

| 字段 | 含义与常见说法 |
|---|---|
| `title` | 奖项名称；获奖情况；荣誉名称；award name; honor |
| `date` | 获奖时间；award date |
| `level` | 获奖级别；国家级/省级/校级 |

## certificates · 证书（数组）

| 字段 | 含义与常见说法 |
|---|---|
| `name` | 证书名称；资格证书；certificate |
| `date` | 证书获得时间；发证日期 |

## languages · 语言能力（数组）

| 字段 | 含义与常见说法 |
|---|---|
| `language` | 语言；外语语种；语言类型；language |
| `cert` | 外语证书；语言成绩；英语等级；CET-6；IELTS；TOEFL；language certificate |
| `level` | 语言掌握程度；熟练程度；听说读写能力；proficiency |

## skills · 技能

| 字段 | 含义与常见说法 |
|---|---|
| `domain` | 技能；专业技能；技能特长；skills |

## family · 家庭成员（数组）

| 字段 | 含义与常见说法 |
|---|---|
| `name` | 家庭成员姓名；父亲姓名；母亲姓名；family member name |
| `relation` | 与本人关系；家庭成员关系；relationship |
| `employer` | 家庭成员工作单位；父母工作单位；family member employer |
| `position` | 家庭成员职务；父母职务；family member position |
| `phone` | 家庭成员联系电话；父母电话；family member phone |

## intent · 求职意向

| 字段 | 含义与常见说法 |
|---|---|
| `position` | 应聘职位；意向岗位；申请职位；desired position |
| `cities` | 期望工作城市；意向城市；期望工作地点；preferred work location |
| `interviewCity` | 期望面试地点；面试城市；interview location |
| `salary` | 期望薪资；期望月薪；expected salary |
| `acceptRelocation` | 是否接受调剂；是否服从调配；accept reassignment |
| `availableDate` | 到岗时间；最快到岗日期；可入职时间；available start date |
| `channel` | 获知招聘信息的渠道；如何了解到本次招聘；信息来源；how did you hear about us |
| `referralCode` | 内推码；推荐码；referral code |
| `jobType` | 求职类型；全职/实习；job type |
| `industry` | 期望行业；industry |
| `workExperience` | 工作年限；工作经验年数；years of experience |

## others · 其他

| 字段 | 含义与常见说法 |
|---|---|
| `personalSite` | 个人主页；个人网站；博客；personal website |
| `portfolio` | 作品集链接；GitHub；portfolio link |
| `selfEvaluation` | 自我评价；自我介绍；个人简介；about me |
| `hobbies` | 兴趣爱好；特长；hobbies |

## records · 档案与声明

| 字段 | 含义与常见说法 |
|---|---|
| `dossierLocation` | 档案所在地；人事档案存放单位 |
| `noCriminal` | 有无犯罪记录；无违法犯罪声明 |

## hkGlobal · 海外与港澳岗位

| 字段 | 含义与常见说法 |
|---|---|
| `workAuth` | 工作签证；工作许可；是否有当地工作权；work authorization |
| `needSponsorship` | 是否需要签证担保；need visa sponsorship |
| `noticePeriod` | 离职通知期；notice period |

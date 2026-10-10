# 网申字段目录

建议先在 Web 账号页的“网申资料”中从本人简历预览导入、确认并补充，再由插件读取。也可使用插件 JSON 资料格式；未知字段不会用于填写。数组顺序必须与实际网页经历对应，日期仅填写已知精度（YYYY / YYYY-MM / YYYY-MM-DD），结束日期可为“至今”。

学习形式 studyMode 与招生培养方式 trainingMode 分开；籍贯 hometown 不代表高考生源地 gaokaoOrigin。没有明确来源的字段留空，不根据学校、姓名或其他资料推断。目录保留兼容项；family、intent、档案和境外政策选择不属于当前确定性自动填写范围，多选和模糊标签也跳过。

## basics · 基本信息

| 字段 | 含义与常见说法 |
| --- | --- |
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
| `hometown` | 籍贯；老家；native place; hometown |
| `gaokaoOrigin` | 高考生源地；高考所在省份 |
| `heightCm` | 身高（厘米）；height |
| `weightKg` | 体重（公斤）；weight |
| `age` | 年龄；age |
| `englishName` | 英文名；English name |
| `hukouType` | 户籍性质；户口性质；household registration type |

## contact · 联系方式

| 字段 | 含义与常见说法 |
| --- | --- |
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
| --- | --- |
| `school` | 学校名称；毕业院校；就读学校；大学；school; university; college |
| `major` | 专业；所学专业；专业名称；major; field of study |
| `degree` | 学历；最高学历；学历层次；本科/硕士/博士；education level |
| `degreeTitle` | 学位；学士/硕士/博士学位；degree |
| `enrollDate` | 入学时间；教育经历开始时间；就读开始日期；start date of study |
| `gradDate` | 毕业时间；教育经历结束时间；预计毕业日期；graduation date; end date of study |
| `gpa` | GPA；绩点；平均学分绩点；grade point average |
| `rank` | 成绩排名；专业排名；class rank |
| `trainingMode` | 培养方式；统招/定向/非定向/委培；admission mode |
| `studentNumber` | 学号；student ID |
| `city` | 学校所在城市；school location |
| `courses` | 主修课程；核心课程；courses |
| `advisor` | 导师姓名；supervisor |
| `studyMode` | 学习形式；教育形式；是否全日制；全日制/非全日制；study mode |
| `department` | 学院名称；所在学院；院系；college department |
| `gpaScale` | 绩点满分；GPA满分；GPA scale |
| `duration` | 学制；修业年限；program duration |

## work · 工作经历（数组）

| 字段 | 含义与常见说法 |
| --- | --- |
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

## internship · 实习经历（数组）

| 字段 | 含义与常见说法 |
| --- | --- |
| `company` | 实习单位；实习公司；internship company |
| `title` | 实习岗位；实习职位；internship position |
| `startDate` | 实习开始时间；internship start date |
| `endDate` | 实习结束时间；internship end date |
| `summary` | 实习内容；实习职责；internship description |
| `salary` | 实习薪资；internship salary |
| `department` | 实习部门 |
| `city` | 实习地点；实习城市；internship location |

## projects · 项目经历（数组）

| 字段 | 含义与常见说法 |
| --- | --- |
| `name` | 项目名称；project name |
| `role` | 项目角色；项目职责；担任职务；project role |
| `description` | 项目描述；项目内容；project description |
| `startDate` | 项目开始时间；project start date |
| `endDate` | 项目结束时间；project end date |
| `link` | 项目链接；project URL |

## awards · 荣誉奖项（数组）

| 字段 | 含义与常见说法 |
| --- | --- |
| `title` | 奖项名称；获奖情况；荣誉名称；award name; honor |
| `date` | 获奖时间；award date |
| `level` | 获奖级别；国家级/省级/校级 |
| `issuer` | 颁奖单位；颁奖机构；award issuer |
| `description` | 奖项说明；获奖描述；award description |

## languages · 语言（数组）

| 字段 | 含义与常见说法 |
| --- | --- |
| `language` | 语言；外语语种；语言类型；language |
| `cert` | 外语证书；语言证书名称；语言考试名称；外语考试名称；language certificate; language exam |
| `level` | 语言掌握程度；熟练程度；听说读写能力；proficiency |
| `score` | 语言考试分数；考试分数；外语考试成绩；language exam score |
| `date` | 语言考试时间；外语考试时间；language exam date |

## skills · 技能

| 字段 | 含义与常见说法 |
| --- | --- |
| `domain` | 技能；专业技能；技能特长；skills |

## family · 家庭成员（数组）

| 字段 | 含义与常见说法 |
| --- | --- |
| `name` | 家庭成员姓名；父亲姓名；母亲姓名；family member name |
| `relation` | 与本人关系；家庭成员关系；relationship |
| `employer` | 家庭成员工作单位；父母工作单位；family member employer |
| `position` | 家庭成员职务；父母职务；family member position |
| `phone` | 家庭成员联系电话；父母电话；family member phone |

## intent · 求职意向

| 字段 | 含义与常见说法 |
| --- | --- |
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

## others · 其他资料

| 字段 | 含义与常见说法 |
| --- | --- |
| `personalSite` | 个人主页；个人网站；博客；personal website |
| `portfolio` | 作品集链接；GitHub；portfolio link |
| `selfEvaluation` | 自我评价；自我介绍；个人简介；about me |
| `hobbies` | 兴趣爱好；特长；hobbies |

## records · 档案

| 字段 | 含义与常见说法 |
| --- | --- |
| `dossierLocation` | 档案所在地；人事档案存放单位 |
| `noCriminal` | 有无犯罪记录；无违法犯罪声明 |

## hkGlobal · 境外申请资料

| 字段 | 含义与常见说法 |
| --- | --- |
| `workAuth` | 工作签证；工作许可；是否有当地工作权；work authorization |
| `needSponsorship` | 是否需要签证担保；need visa sponsorship |
| `noticePeriod` | 离职通知期；notice period |

## certificates · 证书（数组）

| 字段 | 含义与常见说法 |
| --- | --- |
| `name` | 证书名称；资格证书；certificate |
| `date` | 证书获得时间；发证日期 |
| `issuer` | 发证机构；发证单位；issuing authority |
| `number` | 证书编号；资格证书编号；certificate number |

## campus · 校园经历（数组）

| 字段 | 含义与常见说法 |
| --- | --- |
| `organization` | 校园组织；社团名称；学生组织；campus organization |
| `name` | 校园活动名称；活动名称；campus activity name |
| `title` | 担任职务；校园职务；社团职务；campus position |
| `startDate` | 校园经历开始时间；校园活动开始时间；campus activity start date |
| `endDate` | 校园经历结束时间；校园活动结束时间；campus activity end date |
| `description` | 校园活动内容；校园经历描述；campus activity description |

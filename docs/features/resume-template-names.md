# 简历模板名称

79 套新增 Muse 模板名称（含下架款式）采用 4–6 字中文名称。命名结合配色、版式、纸张质感或行业用途，例如「春日来信」「夜航代码」「青岚水彩」「拾光相纸」，避免脱离模板特征的抽象词。新增名称在选择集中唯一，展示名来自 `resume_templates.name`；Web、小程序和管理端均从既有接口读取。

原有 85 套启用模板及其他旧目录项保持数据库中的名称和内容。迁移 `0101` 只替换 79 套 Muse 的种子名称，`0102` 将其调整为当前完整名称；两次均以稳定 key 和已知旧名称匹配，只更新展示名称。模板 ID、key、说明、示例内容、布局、分类、启停和顺序均保持不变，用户已有简历及其模板快照不重写。管理员已改过的名称和自行上传的模板不覆盖。后续改名通过新的向前迁移完成。

迁移 `0104` 下架 14 套新增近似版式后，默认启用目录为 150 套；下表保留历史名称，具体保留清单见[模板目录整理](resume-template-curation.md)。

| 名称 | 原名称 | 模板 key |
| --- | --- | --- |
| 蓝笺工牌 | 蓝色工牌侧栏 | `muse-badge-cn` |
| 春日来信 | HELLO 粉绿色块 | `muse-hello-cn` |
| 夜航代码 | 深蓝代码风 | `muse-code-cn` |
| 绛霞大字 | 橙红底超大姓名 | `muse-vermilion-cn` |
| 金黄手记 | 黄色撕纸便签 + 线圈 | `muse-notebook-cn` |
| 青蓝转角 | 蓝绿 L 形色块 | `muse-elbow-cn` |
| 琥珀柔光 | 米色半透明圆角卡片 | `muse-translucent-cn` |
| 炭灰方章 | 深色方块页眉 + 灰侧栏 | `muse-charcoal-cn` |
| 常青纸页 | 绿色整页 + 横线分栏 | `muse-evergreen-cn` |
| 珊红絮语 | 红色圆角框 + 对话气泡照片 | `muse-speech-cn` |
| 暮砂圆影 | 暖灰圆形照片 + 深色页脚 | `muse-taupe-cn` |
| 蓝瓷纸纹 | 蓝框纸纹 | `muse-paperframe-cn` |
| 珊瑚粉笺 | 珊瑚粉圆角框 | `muse-coral-cn` |
| 纤线留白 | 细体大名 + 双线联系栏 | `muse-hairline-cn` |
| 灰羽侧记 | 灰侧栏 + 右上灰色竖条 | `muse-greyrail-cn` |
| 青岚水彩 | 水彩浅蓝 + 深青右栏 | `muse-watercolor-cn` |
| 斜月时序 | 斜杠标题 + 空心圆时间轴 | `muse-slash-cn` |
| 鼠尾草花笺 | 鼠尾草底 + 双栏网格 | `muse-sagegrid-cn` |
| 雾青圆章 | 雾青侧栏 + 圆形图标标题 | `muse-mist-cn` |
| 晴空弧线 | 蓝天弧线 + 红色标签圆角框 | `muse-sky-cn` |
| 月门留影 | 拱形照片 + 圆点评级 | `muse-archphoto-cn` |
| 深蓝叠影 | 海军蓝侧栏 + 错位投影标签 | `muse-shadowtag-cn` |
| 丹红双栏 | 红色页眉 + 双栏 | `muse-redbanner-cn` |
| 拾光相纸 | 拍立得照片 + 细体衬线名 | `muse-polaroid-cn` |
| 夜蓝金边 | 深蓝页眉 + 明黄侧栏 | `muse-yellowrail-cn` |
| 赭红斜影 | 砖红撞色 + 倾斜卡片 | `muse-tilted-cn` |
| 酒红书纹 | 酒红纹理 + 等宽字体 | `muse-burgundy-cn` |
| 紫霭渐层 | 紫色渐变 + 分栏分隔线 | `muse-violet-cn` |
| 墨夜大字 | 纯黑页面 + 窄体大名 | `muse-noir-cn` |
| 线圈相簿 | 线圈笔记本 + 拍立得 | `muse-spiral-cn` |
| 十字构图 | 窄体巨名 + 十字格线 | `muse-crossgrid-cn` |
| 虹光梦境 | 梦幻光晕 + 右对齐经历框 | `muse-halo-cn` |
| 深海年轮 | 深蓝页眉 + 图标时间轴 | `muse-navymast-cn` |
| 素灰方格 | 浅灰格线版式 | `muse-formgrid-cn` |
| 天青漫染 | 浅蓝页眉 + 蓝色侧栏 | `muse-bluewash-cn` |
| 墨色名章 | 灰侧栏 + 黑色姓名条 | `muse-nameband-cn` |
| 蓝锋斜角 | 蓝色斜角侧栏 | `muse-diagonal-cn` |
| 米白圆弧 | 米白纸面 + 圆角侧栏 | `muse-roundrail-cn` |
| 双线年华 | 粗细姓名 + 双时间轴 | `muse-twintimeline-cn` |
| 靛蓝深海 | 深海军蓝侧栏 | `muse-deeprail-cn` |
| 青影错位 | 青色错位照片框 | `muse-offsetphoto-cn` |
| 折角灰笺 | 灰色侧栏 + 折角标题条 | `muse-folded-cn` |
| 灰阶斜光 | 灰阶斜切页眉 | `muse-slanted-cn` |
| 目录书签 | 目录索引 | `muse-contents-cn` |
| 数字锚点 | 大号数字锚点 | `muse-numerals-cn` |
| 书脊竖韵 | 竖排书脊 | `muse-bookspine-cn` |
| 岁月年谱 | 年谱 | `muse-chronicle-cn` |
| 彩页侧签 | 侧边页签 | `muse-tabs-cn` |
| 建筑蓝图 | 建筑 · 施工图图框 | `muse-blueprint-cn` |
| 梁间图签 | 建筑 · 竖向图签 | `muse-titleblock-cn` |
| 筑梦图录 | 建筑 · 图纸目录 | `muse-drawinglist-cn` |
| 金衡交易簿 | 金融 · 交易列表 | `muse-dealbook-cn` |
| 远见研报 | 金融 · 研报首页 | `muse-researchnote-cn` |
| 墨线底稿 | 审计 · 底稿索引 | `muse-workpaper-cn` |
| 格线明细账 | 审计 · 明细账 | `muse-ledger-cn` |
| 法律备忘录 | 法律 · 备忘录 | `muse-memorandum-cn` |
| 法理札记 | 法律 · 案例摘要 | `muse-casebrief-cn` |
| 晶芯规格书 | 硬件 · 规格书 | `muse-datasheet-cn` |
| 杏林学术 | 医学 · 学术型 | `muse-medicalpapers-cn` |
| 白衣行路 | 医学 · 职业路径 | `muse-clinicalpath-cn` |
| 页边批注 | 教育 · 页边批注 | `muse-annotations-cn` |
| 风起新闻 | 传媒 · 新闻稿 | `muse-press-cn` |
| 青衿育人 | 教育 · 教学·教研·育人 | `muse-teaching-cn` |
| 声色节目单 | 传媒 · 节目串联单 | `muse-rundown-cn` |
| 迭代修订簿 | 硬件 · 修订记录 | `muse-revisions-cn` |
| 知微实验簿 | 实验 · 实验记录本 | `muse-labbook-cn` |
| 元素微光 | 实验 · 元素卡片 | `muse-element-cn` |
| 幕间场刊 | 演艺 · 场刊 | `muse-playbill-cn` |
| 观澜策论 | 咨询 · 结论先行 | `muse-consulting-cn` |
| 三叠姓名牌 | 姓名职位等大三区 | `muse-triptych-cn` |
| 赤红编年 | 暖红编辑单栏 | `muse-rededitorial-cn` |
| 昼夜之间 | 黑白五五分 | `muse-halfblack-cn` |
| 黑幕手写 | 黑色页眉 + 手写体职位 | `muse-blackmast-cn` |
| 墨粒纹理 | 颗粒黑侧栏 + 灰色公司条 | `muse-grainrail-cn` |
| 米笺手迹 | 米色侧栏 + 签名装饰 | `muse-signaturerail-cn` |
| 春日问候 | 问候语姓名 + 圆角衬底 | `muse-greeting-cn` |
| 银灰方影 | 灰条标题 + 方形照片 | `muse-greyleaders-cn` |
| 圆像三章 | 圆形头像页眉 + 底部三栏 | `muse-ruled-cn` |
| 左右落款 | 姓名左上 + 职位右对齐 | `muse-righttitle-cn` |

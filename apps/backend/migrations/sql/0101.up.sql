-- Rename only the 79 newly added Muse catalog entries; preserve all original templates.
-- Match the known seed or name exactly; preserve administrator edits and user snapshots.

UPDATE resume_templates SET name = '蓝笺'
WHERE `key` = 'muse-badge-cn' AND BINARY name = BINARY '蓝色工牌侧栏';

UPDATE resume_templates SET name = '春信'
WHERE `key` = 'muse-hello-cn' AND BINARY name = BINARY 'HELLO 粉绿色块';

UPDATE resume_templates SET name = '夜航'
WHERE `key` = 'muse-code-cn' AND BINARY name = BINARY '深蓝代码风';

UPDATE resume_templates SET name = '绛霞'
WHERE `key` = 'muse-vermilion-cn' AND BINARY name = BINARY '橙红底超大姓名';

UPDATE resume_templates SET name = '金页'
WHERE `key` = 'muse-notebook-cn' AND BINARY name = BINARY '黄色撕纸便签 + 线圈';

UPDATE resume_templates SET name = '转青'
WHERE `key` = 'muse-elbow-cn' AND BINARY name = BINARY '蓝绿 L 形色块';

UPDATE resume_templates SET name = '琥珀'
WHERE `key` = 'muse-translucent-cn' AND BINARY name = BINARY '米色半透明圆角卡片';

UPDATE resume_templates SET name = '玄阶'
WHERE `key` = 'muse-charcoal-cn' AND BINARY name = BINARY '深色方块页眉 + 灰侧栏';

UPDATE resume_templates SET name = '常青'
WHERE `key` = 'muse-evergreen-cn' AND BINARY name = BINARY '绿色整页 + 横线分栏';

UPDATE resume_templates SET name = '红语'
WHERE `key` = 'muse-speech-cn' AND BINARY name = BINARY '红色圆角框 + 对话气泡照片';

UPDATE resume_templates SET name = '暮砂'
WHERE `key` = 'muse-taupe-cn' AND BINARY name = BINARY '暖灰圆形照片 + 深色页脚';

UPDATE resume_templates SET name = '蓝瓷'
WHERE `key` = 'muse-paperframe-cn' AND BINARY name = BINARY '蓝框纸纹';

UPDATE resume_templates SET name = '珊瑚'
WHERE `key` = 'muse-coral-cn' AND BINARY name = BINARY '珊瑚粉圆角框';

UPDATE resume_templates SET name = '轻墨'
WHERE `key` = 'muse-hairline-cn' AND BINARY name = BINARY '细体大名 + 双线联系栏';

UPDATE resume_templates SET name = '灰羽'
WHERE `key` = 'muse-greyrail-cn' AND BINARY name = BINARY '灰侧栏 + 右上灰色竖条';

UPDATE resume_templates SET name = '青岚'
WHERE `key` = 'muse-watercolor-cn' AND BINARY name = BINARY '水彩浅蓝 + 深青右栏';

UPDATE resume_templates SET name = '斜月'
WHERE `key` = 'muse-slash-cn' AND BINARY name = BINARY '斜杠标题 + 空心圆时间轴';

UPDATE resume_templates SET name = '鼠尾草'
WHERE `key` = 'muse-sagegrid-cn' AND BINARY name = BINARY '鼠尾草底 + 双栏网格';

UPDATE resume_templates SET name = '雾青'
WHERE `key` = 'muse-mist-cn' AND BINARY name = BINARY '雾青侧栏 + 圆形图标标题';

UPDATE resume_templates SET name = '晴空'
WHERE `key` = 'muse-sky-cn' AND BINARY name = BINARY '蓝天弧线 + 红色标签圆角框';

UPDATE resume_templates SET name = '月门'
WHERE `key` = 'muse-archphoto-cn' AND BINARY name = BINARY '拱形照片 + 圆点评级';

UPDATE resume_templates SET name = '海影'
WHERE `key` = 'muse-shadowtag-cn' AND BINARY name = BINARY '海军蓝侧栏 + 错位投影标签';

UPDATE resume_templates SET name = '丹帷'
WHERE `key` = 'muse-redbanner-cn' AND BINARY name = BINARY '红色页眉 + 双栏';

UPDATE resume_templates SET name = '拾光'
WHERE `key` = 'muse-polaroid-cn' AND BINARY name = BINARY '拍立得照片 + 细体衬线名';

UPDATE resume_templates SET name = '夜金'
WHERE `key` = 'muse-yellowrail-cn' AND BINARY name = BINARY '深蓝页眉 + 明黄侧栏';

UPDATE resume_templates SET name = '赭舞'
WHERE `key` = 'muse-tilted-cn' AND BINARY name = BINARY '砖红撞色 + 倾斜卡片';

UPDATE resume_templates SET name = '酒诗'
WHERE `key` = 'muse-burgundy-cn' AND BINARY name = BINARY '酒红纹理 + 等宽字体';

UPDATE resume_templates SET name = '紫霭'
WHERE `key` = 'muse-violet-cn' AND BINARY name = BINARY '紫色渐变 + 分栏分隔线';

UPDATE resume_templates SET name = '墨夜'
WHERE `key` = 'muse-noir-cn' AND BINARY name = BINARY '纯黑页面 + 窄体大名';

UPDATE resume_templates SET name = '环记'
WHERE `key` = 'muse-spiral-cn' AND BINARY name = BINARY '线圈笔记本 + 拍立得';

UPDATE resume_templates SET name = '十方'
WHERE `key` = 'muse-crossgrid-cn' AND BINARY name = BINARY '窄体巨名 + 十字格线';

UPDATE resume_templates SET name = '虹晕'
WHERE `key` = 'muse-halo-cn' AND BINARY name = BINARY '梦幻光晕 + 右对齐经历框';

UPDATE resume_templates SET name = '深潮'
WHERE `key` = 'muse-navymast-cn' AND BINARY name = BINARY '深蓝页眉 + 图标时间轴';

UPDATE resume_templates SET name = '素格'
WHERE `key` = 'muse-formgrid-cn' AND BINARY name = BINARY '浅灰格线版式';

UPDATE resume_templates SET name = '天青'
WHERE `key` = 'muse-bluewash-cn' AND BINARY name = BINARY '浅蓝页眉 + 蓝色侧栏';

UPDATE resume_templates SET name = '墨铭'
WHERE `key` = 'muse-nameband-cn' AND BINARY name = BINARY '灰侧栏 + 黑色姓名条';

UPDATE resume_templates SET name = '蓝锋'
WHERE `key` = 'muse-diagonal-cn' AND BINARY name = BINARY '蓝色斜角侧栏';

UPDATE resume_templates SET name = '米月'
WHERE `key` = 'muse-roundrail-cn' AND BINARY name = BINARY '米白纸面 + 圆角侧栏';

UPDATE resume_templates SET name = '双流'
WHERE `key` = 'muse-twintimeline-cn' AND BINARY name = BINARY '粗细姓名 + 双时间轴';

UPDATE resume_templates SET name = '靛河'
WHERE `key` = 'muse-deeprail-cn' AND BINARY name = BINARY '深海军蓝侧栏';

UPDATE resume_templates SET name = '青影'
WHERE `key` = 'muse-offsetphoto-cn' AND BINARY name = BINARY '青色错位照片框';

UPDATE resume_templates SET name = '折笺'
WHERE `key` = 'muse-folded-cn' AND BINARY name = BINARY '灰色侧栏 + 折角标题条';

UPDATE resume_templates SET name = '灰弧'
WHERE `key` = 'muse-slanted-cn' AND BINARY name = BINARY '灰阶斜切页眉';

UPDATE resume_templates SET name = '索隐'
WHERE `key` = 'muse-contents-cn' AND BINARY name = BINARY '目录索引';

UPDATE resume_templates SET name = '数章'
WHERE `key` = 'muse-numerals-cn' AND BINARY name = BINARY '大号数字锚点';

UPDATE resume_templates SET name = '竖韵'
WHERE `key` = 'muse-bookspine-cn' AND BINARY name = BINARY '竖排书脊';

UPDATE resume_templates SET name = '岁序'
WHERE `key` = 'muse-chronicle-cn' AND BINARY name = BINARY '年谱';

UPDATE resume_templates SET name = '页边'
WHERE `key` = 'muse-tabs-cn' AND BINARY name = BINARY '侧边页签';

UPDATE resume_templates SET name = '构境'
WHERE `key` = 'muse-blueprint-cn' AND BINARY name = BINARY '建筑 · 施工图图框';

UPDATE resume_templates SET name = '梁影'
WHERE `key` = 'muse-titleblock-cn' AND BINARY name = BINARY '建筑 · 竖向图签';

UPDATE resume_templates SET name = '筑序'
WHERE `key` = 'muse-drawinglist-cn' AND BINARY name = BINARY '建筑 · 图纸目录';

UPDATE resume_templates SET name = '金衡'
WHERE `key` = 'muse-dealbook-cn' AND BINARY name = BINARY '金融 · 交易列表';

UPDATE resume_templates SET name = '远见'
WHERE `key` = 'muse-researchnote-cn' AND BINARY name = BINARY '金融 · 研报首页';

UPDATE resume_templates SET name = '墨证'
WHERE `key` = 'muse-workpaper-cn' AND BINARY name = BINARY '审计 · 底稿索引';

UPDATE resume_templates SET name = '格律'
WHERE `key` = 'muse-ledger-cn' AND BINARY name = BINARY '审计 · 明细账';

UPDATE resume_templates SET name = '衡文'
WHERE `key` = 'muse-memorandum-cn' AND BINARY name = BINARY '法律 · 备忘录';

UPDATE resume_templates SET name = '法度'
WHERE `key` = 'muse-casebrief-cn' AND BINARY name = BINARY '法律 · 案例摘要';

UPDATE resume_templates SET name = '晶序'
WHERE `key` = 'muse-datasheet-cn' AND BINARY name = BINARY '硬件 · 规格书';

UPDATE resume_templates SET name = '杏林'
WHERE `key` = 'muse-medicalpapers-cn' AND BINARY name = BINARY '医学 · 学术型';

UPDATE resume_templates SET name = '白径'
WHERE `key` = 'muse-clinicalpath-cn' AND BINARY name = BINARY '医学 · 职业路径';

UPDATE resume_templates SET name = '批墨'
WHERE `key` = 'muse-annotations-cn' AND BINARY name = BINARY '教育 · 页边批注';

UPDATE resume_templates SET name = '风讯'
WHERE `key` = 'muse-press-cn' AND BINARY name = BINARY '传媒 · 新闻稿';

UPDATE resume_templates SET name = '青衿'
WHERE `key` = 'muse-teaching-cn' AND BINARY name = BINARY '教育 · 教学·教研·育人';

UPDATE resume_templates SET name = '声序'
WHERE `key` = 'muse-rundown-cn' AND BINARY name = BINARY '传媒 · 节目串联单';

UPDATE resume_templates SET name = '迭谱'
WHERE `key` = 'muse-revisions-cn' AND BINARY name = BINARY '硬件 · 修订记录';

UPDATE resume_templates SET name = '知微'
WHERE `key` = 'muse-labbook-cn' AND BINARY name = BINARY '实验 · 实验记录本';

UPDATE resume_templates SET name = '微光'
WHERE `key` = 'muse-element-cn' AND BINARY name = BINARY '实验 · 元素卡片';

UPDATE resume_templates SET name = '幕间'
WHERE `key` = 'muse-playbill-cn' AND BINARY name = BINARY '演艺 · 场刊';

UPDATE resume_templates SET name = '观澜'
WHERE `key` = 'muse-consulting-cn' AND BINARY name = BINARY '咨询 · 结论先行';

UPDATE resume_templates SET name = '三叠'
WHERE `key` = 'muse-triptych-cn' AND BINARY name = BINARY '姓名职位等大三区';

UPDATE resume_templates SET name = '赤笺'
WHERE `key` = 'muse-rededitorial-cn' AND BINARY name = BINARY '暖红编辑单栏';

UPDATE resume_templates SET name = '昼夜'
WHERE `key` = 'muse-halfblack-cn' AND BINARY name = BINARY '黑白五五分';

UPDATE resume_templates SET name = '玄幕'
WHERE `key` = 'muse-blackmast-cn' AND BINARY name = BINARY '黑色页眉 + 手写体职位';

UPDATE resume_templates SET name = '墨粒'
WHERE `key` = 'muse-grainrail-cn' AND BINARY name = BINARY '颗粒黑侧栏 + 灰色公司条';

UPDATE resume_templates SET name = '手迹'
WHERE `key` = 'muse-signaturerail-cn' AND BINARY name = BINARY '米色侧栏 + 签名装饰';

UPDATE resume_templates SET name = '问春'
WHERE `key` = 'muse-greeting-cn' AND BINARY name = BINARY '问候语姓名 + 圆角衬底';

UPDATE resume_templates SET name = '银线'
WHERE `key` = 'muse-greyleaders-cn' AND BINARY name = BINARY '灰条标题 + 方形照片';

UPDATE resume_templates SET name = '圆叙'
WHERE `key` = 'muse-ruled-cn' AND BINARY name = BINARY '圆形头像页眉 + 底部三栏';

UPDATE resume_templates SET name = '落款'
WHERE `key` = 'muse-righttitle-cn' AND BINARY name = BINARY '姓名左上 + 职位右对齐';

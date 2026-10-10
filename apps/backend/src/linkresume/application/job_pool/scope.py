"""Admission scope of the official job pool: technology jobs located in mainland China.

Places are judged by an overseas list rather than a mainland list: an unknown
place name is kept, so a missing county-level city never drops a domestic job.
Bump SCOPE_VERSION whenever these rules change; the first complete sync under a
new version re-baselines the source instead of reporting a count drop.
"""
from __future__ import annotations

import re

from linkresume.application.job_pool.types import JobObservation

SCOPE_VERSION = 1

OVERSEAS_CJK = (
    "海外", "境外", "国外", "香港", "澳门", "台湾", "台北", "台中", "台南", "高雄", "新竹",
    "美国", "加拿大", "墨西哥", "巴西", "阿根廷", "智利", "秘鲁", "哥伦比亚", "英国", "爱尔兰", "法国", "德国",
    "荷兰", "比利时", "卢森堡", "瑞士", "奥地利", "意大利", "西班牙", "葡萄牙", "希腊", "瑞典", "挪威", "芬兰",
    "丹麦", "冰岛", "波兰", "捷克", "匈牙利", "罗马尼亚", "乌克兰", "俄罗斯", "土耳其", "以色列", "日本", "韩国",
    "新加坡", "马来西亚", "泰国", "越南", "印度", "印尼", "菲律宾", "柬埔寨", "缅甸", "老挝", "孟加拉", "巴基斯坦",
    "斯里兰卡", "哈萨克斯坦", "乌兹别克", "蒙古国", "阿联酋", "沙特", "卡塔尔", "科威特", "阿曼", "伊拉克", "伊朗",
    "约旦", "埃及", "摩洛哥", "阿尔及利亚", "南非", "尼日利亚", "肯尼亚", "埃塞俄比亚", "澳大利亚", "澳洲", "新西兰",
    "硅谷", "加州", "旧金山", "圣何塞", "西雅图", "洛杉矶", "圣地亚哥", "纽约", "波士顿", "芝加哥", "奥斯汀", "华盛顿",
    "多伦多", "温哥华", "蒙特利尔", "伦敦", "剑桥", "巴黎", "柏林", "慕尼黑", "法兰克福", "阿姆斯特丹", "都柏林",
    "马德里", "巴塞罗那", "米兰", "罗马", "苏黎世", "斯德哥尔摩", "赫尔辛基", "哥本哈根", "华沙", "布拉格",
    "布达佩斯", "莫斯科", "伊斯坦布尔", "特拉维夫", "东京", "大阪", "首尔", "釜山", "吉隆坡", "曼谷", "河内",
    "胡志明", "雅加达", "马尼拉", "孟买", "班加罗尔", "新德里", "迪拜", "阿布扎比", "利雅得", "多哈", "开罗",
    "约翰内斯堡", "拉各斯", "内罗毕", "悉尼", "墨尔本", "圣保罗",
)
OVERSEAS_LATIN = re.compile(r"\b(?:" + "|".join((
    "overseas", "usa", "u\\.s\\.a?", "united states", "america", "canada", "mexico", "brazil", "argentina", "chile",
    "uk", "united kingdom", "england", "ireland", "france", "germany", "netherlands", "belgium", "switzerland",
    "austria", "italy", "spain", "portugal", "sweden", "norway", "finland", "denmark", "poland", "czech",
    "hungary", "romania", "ukraine", "russia", "turkey", "israel", "japan", "korea", "singapore", "malaysia",
    "thailand", "vietnam", "india", "indonesia", "philippines", "cambodia", "pakistan", "kazakhstan", "uae",
    "saudi", "qatar", "egypt", "south africa", "nigeria", "kenya", "australia", "new zealand",
    "hong kong", "hongkong", "macau", "macao", "taiwan", "taipei",
    "silicon valley", "bay area", "san francisco", "san jose", "mountain view", "palo alto", "sunnyvale",
    "menlo park", "seattle", "los angeles", "san diego", "new york", "boston", "chicago", "austin", "toronto",
    "vancouver", "montreal", "london", "paris", "berlin", "munich", "frankfurt", "amsterdam", "dublin", "madrid",
    "barcelona", "milan", "zurich", "stockholm", "helsinki", "copenhagen", "warsaw", "prague", "budapest",
    "moscow", "istanbul", "tel aviv", "tokyo", "osaka", "seoul", "kuala lumpur", "bangkok", "hanoi",
    "ho chi minh", "jakarta", "manila", "mumbai", "bangalore", "bengaluru", "delhi", "dubai", "abu dhabi",
    "riyadh", "doha", "cairo", "johannesburg", "lagos", "nairobi", "sydney", "melbourne", "sao paulo", "são paulo",
)) + r")\b", re.IGNORECASE)

# Role types that are never technology jobs, even with a technology word in the title
# ("销售工程师", "大模型技术支持工程师", "硬件项目经理").
EXCLUDED = (
    "销售", "售前", "售后", "技术支持", "客户成功", "客户经理", "大客户", "商务", "业务开发", "业务拓展", "招聘", "人力",
    "HRBP", "财务", "会计", "审计", "税务", "法务", "律师", "行政", "秘书", "产品经理", "产品专家", "产品总监",
    "产品负责人", "设计师", "项目经理", "项目管理", "PMO", "TPM", "解决方案", "实施工程师", "落地专家", "工艺",
    "设备工程师", "设备维护", "设备技术员", "技术员", "质量工程师", "质量经理", "质量管理", "质量体系", "品质", "质检",
    "生产计划", "生产管理", "生产主管", "生产工程师", "生产技术", "制造工程", "采购", "操作工", "普工", "技工",
    "安全员", "讲师", "教师", "教研", "编导", "导演", "战略", "产业研究", "行业研究", "人才探索", "人才发展",
    "组织效能", "语言学", "技术文档", "资产管理", "资源开发", "报建",
)
EXCLUDED_LATIN = re.compile(r"(?<![a-z])(?:sales|pre-?sales|marketing|recruit(?:er|ing)?|hrbp|product manager|"
    r"product owner|account manager|business development|customer success|(?:ui|ux|visual|graphic) designer|"
    r"solutions? (?:architect|engineer|manager|lead)|forward deployed|partnership|gtm|hr|physical security|sqe|qe)(?![a-z])",
    re.IGNORECASE)
# Business words that only mark a non-technology job when the title names no technology direction
# ("营销算法工程师" and "安全合规工程师" stay technology jobs).
WEAK_EXCLUDED = (
    "运营", "市场", "营销", "品牌", "公关", "渠道", "策划", "合规", "投资", "客服", "供应链", "物流", "仓储", "维修", "安装",
    "施工", "标注", "评估", "视觉设计", "交互设计", "体验设计", "产品设计", "平面设计", "工业设计", "多媒体设计", "UI设计", "美术", "原画",
    "动画", "插画",
)
# "产品" marks a product role unless it names product engineering ("产品研发 / 产品测试").
PRODUCT_ROLE = re.compile(r"产品(?!研发|开发|测试|工程|技术|架构|安全)")
# A role that ends in a business noun is that role, whatever technology it serves
# ("Agent策略产品实习生", "大模型运营", "UE5游戏战斗策划专家").
ROLE_SUFFIX = re.compile(r"(?:产品|产品设计|运营|策划|营销|市场|商务|品牌)(?:经理|专家|专员|主管|负责人|总监|岗)?(?:实习生)?$")
# Team names and notes, before ("腾讯营销-AI Agent 架构师") or after ("后端开发工程师 - 抖音平台产品")
# the role, and bracketed ("前端研发（客服平台方向）").
_BRACKETS = re.compile(r"[（(【\[][^）)】\]]*[）)】\]]")
_ROLE_NOUN = re.compile(r"工程师|开发|研发|架构师|专家|经理|实习生|研究员|设计师|策划|运营|分析师|负责人|主管|专员|总监|顾问|"
    r"(?<![a-z])(?:engineer|developer|manager|scientist|lead|intern|architect)", re.IGNORECASE)
# Business words do not override a title that ends in an engineering role ("营销算法工程师", "网络运营工程师").
_ENGINEERING_ROLE = re.compile(r"(?:工程师|开发|研发|架构师|研究员|程序员|engineer|developer)$", re.IGNORECASE)
_TEAM_SUFFIX = re.compile(r"\s+[-－—–|]\s*|[－—–|]|-(?=[\s\u4e00-\u9fffA-Z])")
# Engineering outside software and electronics; dropped unless the title names a technology direction.
NON_IT_ENGINEERING = ("机械", "结构工程师", "电气", "材料", "化学", "电化学", "电池", "土木", "暖通", "给排水",
    "环境", "医学", "临床", "药", "注册", "法规", "工程造价", "测绘")

DIRECTIONS = (
    ("芯片", ("芯片", "集成电路", "半导体", "数字前端", "数字后端", "数字设计", "数字验证", "数字IC", "模拟IC", "版图", "IC设计",
             "IC验证"),
     ("ic", "soc", "asic", "fpga", "rtl", "dft", "eda", "verilog")),
    ("嵌入式", ("嵌入式", "单片机", "驱动开发", "驱动工程师", "固件", "内核开发", "底层软件", "Linux内核"),
     ("mcu", "bsp", "firmware", "rtos", "embedded")),
    ("硬件", ("硬件", "电路", "射频", "电子工程", "电源工程", "电源设计", "天线", "信号完整性"), ("pcb", "rf", "hardware")),
    ("算法", ("算法", "机器学习", "深度学习", "大模型", "自然语言", "计算机视觉", "多模态", "强化学习", "语音识别",
              "推荐系统", "搜索引擎", "感知", "规划控制", "智能体", "推理优化", "推理加速"),
     ("llm", "nlp", "cv", "aigc", "slam", "agent", "algorithm", "machine learning", "research", "scientist")),
    ("前端", ("前端", "小程序"), ("h5", "fe", "frontend", "front-end")),
    ("客户端", ("客户端", "移动端", "安卓", "鸿蒙", "桌面端", "游戏引擎"),
     ("ios", "android", "flutter", "harmonyos", "unity", "ue4", "ue5", "client")),
    ("测试", ("测试", "质量保障", "评测"), ("qa", "sdet", "test")),
    ("数据", ("数据开发", "数据工程", "数据仓库", "数仓", "大数据", "数据分析", "数据挖掘", "数据科学", "数据平台", "数据治理"),
     ("bi", "etl", "data")),
    ("运维", ("运维", "网络工程师", "数据库管理", "云平台"), ("sre", "devops", "dba", "ops")),
    ("安全", ("网络安全", "信息安全", "安全研发", "安全开发", "安全工程师", "安全专家", "安全研究", "渗透", "攻防", "漏洞"),
     ("security",)),
    ("后端", ("后端", "后台开发", "后台研发", "服务端", "服务器端", "分布式", "中间件", "基础架构", "架构师", "存储", "数据库内核", "云原生", "微服务",
              "Go开发", "Go工程师"),
     ("backend", "back-end", "infra", "server", "java", "golang", "c\\+\\+", "python", "php", "rust", "node(?:\\.js)?")),
    ("研发", ("研发", "开发", "软件", "程序", "编程", "全栈", "技术专家", "技术经理", "技术负责人", "音视频", "编解码",
              "多媒体", "图形", "渲染", "编译", "操作系统", "性能优化", "系统优化", "虚拟化", "自动化", "系统架构", "架构工程师"),
     ("software", "developer", "engineer(?:ing)?", "sde", "cto", "full-?stack")),
)
_DIRECTION_LATIN = tuple((name, re.compile(r"(?<![a-z])(?:" + "|".join(words) + r")(?![a-z])", re.IGNORECASE))
    for name, _, words in DIRECTIONS)
TECH_CATEGORY = ("技术", "研发", "开发", "算法", "软件")
DIRECTION_NAMES = tuple(name for name, _, _ in DIRECTIONS)


def is_overseas(place: str) -> bool:
    text = place.strip()
    return bool(text) and (any(name in text for name in OVERSEAS_CJK) or bool(OVERSEAS_LATIN.search(text)))


def domestic_places(places: list[str]) -> list[str] | None:
    """Return the non-overseas places, or None when every listed place is overseas."""
    kept = [place for place in places if not is_overseas(place)]
    return None if places and not kept else kept


def role_text(title: str) -> str:
    """The role part of a title: the first team-separated segment naming a role, without bracketed notes."""
    segments = [part.strip(" #") for part in _TEAM_SUFFIX.split(_BRACKETS.sub(" ", title)) if part.strip(" #")]
    return next((part for part in segments if _ROLE_NOUN.search(part)), segments[0] if segments else title)


def _excluded(text: str) -> bool:
    return any(word in text for word in EXCLUDED) or bool(EXCLUDED_LATIN.search(text))


def _weak(text: str) -> bool:
    return any(word in text for word in WEAK_EXCLUDED) or bool(PRODUCT_ROLE.search(text))


def _direction(text: str, *, generic: bool = True) -> str | None:
    for (name, words, _), (_, latin) in zip(DIRECTIONS, _DIRECTION_LATIN):
        if name == "研发" and not generic:
            break
        if any(word in text for word in words) or latin.search(text):
            return name
    return None


def title_decision(title: str) -> str | None:
    """Decide from the title alone: a direction, "" when excluded, or None when undecided.

    Only the role part counts. A specific direction outranks weak business words and
    non-IT engineering words ("营销算法", "电池测试"); a generic "研发 / 开发" does not ("材料研发").
    """
    role = role_text(title)
    if _excluded(role) or ROLE_SUFFIX.search(role):
        return ""
    direction = _direction(role, generic=False)
    if direction:
        return direction
    if _weak(role) and not _ENGINEERING_ROLE.search(role):
        return None
    if any(word in role for word in NON_IT_ENGINEERING):
        return ""
    return _direction(role)


def classify(title: str, category: str | None) -> str | None:
    """Return the technology direction of a job, or None when it is out of scope."""
    decided = title_decision(title)
    if decided is not None:
        return decided or None
    text = (category or "").strip()
    if text in DIRECTION_NAMES:
        # Already a direction assigned by this module (stored jobs being re-checked).
        return text
    role = role_text(title)
    if (not text or _excluded(text) or _weak(text) or (_weak(role) and not _ENGINEERING_ROLE.search(role))
            or any(word in text for word in NON_IT_ENGINEERING)):
        return None
    return _direction(text) or ("研发" if any(word in text for word in TECH_CATEGORY) else None)


def skip_listing(title: str | None, category: str | None, places: list[str] | None) -> bool:
    """Whether a list row is already out of scope, so its detail need not be fetched."""
    if places and domestic_places(places) is None:
        return True
    if not title:
        return False
    return title_decision(title) == "" or (category is not None and classify(title, category) is None)


def admit(job: JobObservation) -> JobObservation | None:
    places = domestic_places(job.locations["cities"])
    raw = job.locations["raw"]
    if raw and domestic_places(raw) is None:
        # Some readers keep only the last segment of "美国-加州"; the raw text still names the country.
        places = None
    direction = classify(job.job_title, job.source_category if job.source_category is not None else job.job_category)
    if places is None or direction is None:
        return None
    return job.model_copy(update={"job_category": direction, "locations": job.locations | {"cities": places}})

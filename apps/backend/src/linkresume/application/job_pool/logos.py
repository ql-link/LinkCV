"""Company artwork from curated careers pages, never an ATS provider's favicon.

Only read registered pages. Image addresses are returned as external HTTPS URLs;
this module does not download images or accept user-supplied fetch destinations.
"""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

from linkresume.application.job_pool.catalog import CompanySource


# Explicit entry paths avoid following redirects (including HTTP downgrades).
LOGO_PAGES = {
    "meituan": "https://zhaopin.meituan.com/web/home",
    "baidu": "https://talent.baidu.com/jobs/social",
    "jd": "https://zhaopin.jd.com/home",
    "alibaba": "https://campus-talent.alibaba.com/campus/index",
    "zhipu": "https://www.zhipuai.cn/zh",
    "longi": "https://www.longi.com/cn/career/",
}

# Verified corporate artwork for careers shells without a usable company mark.
# Tencent's careers CDN is hotlink-protected; JD's old favicon points to HTTP.
FIXED_LOGOS = {
    "tencent": "https://www.tencent.com/wp-content/uploads/2022/12/logo@2x.png?2",
    "jd": "https://www.jd.com/favicon.ico",
    "xiaomi": "https://i01.appmifile.com/webfile/globalimg/logo/pwa-mi/72x72.png",
    "lilith": "https://lilithimage.lilithcdn.com/allgames-official-web/lilith/pc/cn/favicon.ico",
    "moonton": "https://en.moonton.com/static/skin/images/company_logo.png",
    "weimob": "https://job.weimob.com/assets/img/Logo.svg",
    "hikvision": "https://talent.hikvision.com/group1/M00/38/4D/CgEL-2N2JFCAa_1dAAAUXi7EvNo664.jpg",
    "honor": "https://www.honor.com/etc/designs/honor-site/assets/favicon-192x192.png",
    "gree": "https://gree.com/assets/greeLogo.png",
    "xcmg-social": "https://www.xcmg.com/favicon.ico",
    "xcmg-campus": "https://www.xcmg.com/favicon.ico",
    "byd": "https://www.byd.com/static_material/byd/cn/images/favicon.ico",
}

# Exact hosts observed on the registered company's page, not arbitrary CDN suffixes.
LOGO_HOSTS = {
    "tencent": ("www.tencent.com", "cdn.multilingualres.hr.tencent.com"),
    "bytedance": ("lf3-static.bytednsdoc.com", "lf3-cdn-tos.bytescm.com"),
    "minimax": ("lf3-atsx-tob.feishucdn.com",),
    "meituan": ("s3plus.meituan.net",),
    "baidu": ("talent-offical-static-prod.cdn.bcebos.com", "talent-fe.cdn.bcebos.com"),
    "alibaba": ("g.alicdn.com",),
    "kuaishou": ("s2-11760.kwimgs.com",),
    "xiaohongshu": ("www.xiaohongshu.com",),
    "bilibili": ("s1.hdslb.com",),
    "pdd": ("funimg.pddpic.com",),
    "didi": ("website.didiglobal.com",),
    "jd": ("www.jd.com",),
    "moonshot": ("public-cdn.mokahr.com",),
    "deepseek": ("public-cdn.mokahr.com",),
    "dewu": ("lf3-atsx-tob.feishucdn.com",),
    "kurogame": ("lf3-atsx-tob.feishucdn.com",),
    "01ai": ("lf3-atsx-tob.feishucdn.com",),
    "ant": ("gw.alipayobjects.com",),
    "xiaomi": ("i01.appmifile.com",),
    "lilith": ("lilithimage.lilithcdn.com",),
    "moonton": ("en.moonton.com",),
    "dewu-campus": ("lf3-atsx-tob.feishucdn.com",),
    "zhipu": ("www.zhipuai.cn",),
    "byd": ("www.byd.com",),
    "longi": ("www.longi.com", "static.longi.com"),
    "honor": ("www.honor.com",),
    "gree": ("gree.com",),
    "xcmg-social": ("www.xcmg.com",),
    "xcmg-campus": ("www.xcmg.com",),
}


def logo_page(source: CompanySource) -> str:
    return LOGO_PAGES.get(source.key, source.url)


def moka_logo_host(source: CompanySource) -> str:
    return "public-cdn-tc.mokahr.com" if urlsplit(source.url).hostname == "app-tc.mokahr.com" else "public-cdn.mokahr.com"


def safe_logo_url(source: CompanySource, value: str | None) -> str | None:
    if not value or len(value) > 2048 or re.search(r"[\s\\\x00-\x1f\x7f]", value):
        return None
    try:
        value = urljoin(logo_page(source), value)
        if len(value) > 2048:
            return None
        parsed = urlsplit(value)
        hosts = {urlsplit(source.url).hostname, *LOGO_HOSTS.get(source.key, ())}
        if source.adapter in {"moka", "moka-campus"}:
            cdn_host = moka_logo_host(source)
            hosts.add(cdn_host)
            if parsed.hostname == cdn_host and not parsed.path.startswith(f"/{source.host}/"):
                return None
        elif source.adapter == "feishu":
            hosts.update(("lf3-atsx-tob.feishucdn.com", "lf3-static.bytednsdoc.com"))
        elif source.adapter == "beisen":
            hosts.update(("stcms.beisen.com", "portal-oss.zhiye.com"))
        elif source.adapter == "alibaba-cpo":
            hosts.update(("g.alicdn.com", "assets.alicdn.com"))
        if (parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username
                or parsed.password or parsed.port not in (None, 443)):
            return None
    except ValueError:
        return None
    return value


class LogoTags(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.images: list[str] = []
        self.icons: list[str] = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "img":
            label = " ".join(attrs.get(key) or "" for key in ("class", "id", "alt"))
            if re.search(r"(?:^|[-_\s])logo(?:$|[-_\s])", label, re.I):
                self.images.append(attrs.get("src") or attrs.get("data-src") or "")
        elif tag == "link":
            rel = (attrs.get("rel") or "").lower().split()
            if "icon" in rel or "apple-touch-icon" in rel:
                self.icons.append(attrs.get("href") or "")


class MokaInit(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.value = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "input" and attrs.get("id") == "init-data":
            self.value = attrs.get("value")


def moka_logo(source: CompanySource, page: str) -> str | None:
    parser = MokaInit()
    parser.feed(page)
    try:
        data = json.loads(parser.value or "null")
        if not isinstance(data, dict) or str(data.get("siteId")) != str(source.site_id):
            return None
        org = data["org"]
        if org.get("id") != source.host:
            return None
        nav = (org.get("webSettings") or {}).get("nav") or {}
        candidates = [org.get("logo"), (nav.get("logo") or {}).get("url")]
        for value in candidates:
            if not isinstance(value, str):
                continue
            url = safe_logo_url(source, value)
            # Shared Moka CDN artwork must belong to this exact tenant.
            if url and urlsplit(url).hostname == moka_logo_host(source) and urlsplit(url).path.startswith(f"/{source.host}/"):
                return url
    except (ValueError, KeyError, TypeError, AttributeError):
        return None
    return None


def extract_logo(source: CompanySource, page: str) -> str | None:
    if source.adapter in {"moka", "moka-campus"}:
        return moka_logo(source, page)
    candidates: list[str] = []
    if source.adapter == "feishu":
        # Tenant-specific header config can be a JSON string nested in page boot data.
        unescaped = page.replace('\\"', '"').replace("\\/", "/")
        for key in ("logoURL", "pc_logo", "navigation_bar_img_url"):
            for match in re.finditer(r'"' + key + r'"\s*:\s*("(?:[^"\\]|\\.)*")', unescaped):
                try:
                    value = json.loads(match[1])
                    if isinstance(value, str) and "/saas_career/" not in value:
                        candidates.append(value)
                except ValueError:
                    continue
    if source.adapter != "feishu" or source.key in LOGO_PAGES:
        parser = LogoTags()
        parser.feed(page)
        # A brand image takes precedence over the site's compact brand icon.
        if source.adapter == "beisen":
            # Beisen exposes the tenant's brand in its boot configuration.
            for match in re.finditer(r'"Logo"\s*:\s*("(?:[^"\\]|\\.)*")', page):
                try:
                    candidates.append(json.loads(match[1]))
                except ValueError:
                    continue
            candidates.extend(parser.images)
        else:
            candidates.extend(parser.images + parser.icons)
    # Moka's shared shell/favicon is not evidence of a tenant's company logo.
    return next((url for item in candidates if isinstance(item, str)
        and (url := safe_logo_url(source, item))), None)

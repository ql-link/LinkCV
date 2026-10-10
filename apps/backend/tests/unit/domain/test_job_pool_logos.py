import asyncio
import json

import pytest

from linkresume.application.job_pool.adapters import CollectionError, OfficialAdapter
from linkresume.application.job_pool.catalog import CATALOG
from linkresume.application.job_pool.logos import extract_logo, logo_page, safe_logo_url


def source(key):
    return next(item for item in CATALOG if item.key == key)


def test_tenant_header_config_is_preferred_to_generic_ats_favicon():
    image = "https://lf3-atsx-tob.feishucdn.com/obj/fictional-company.png"
    page = '<link rel="icon" href="https://lf-package-cn.feishucdn.com/generic-ats.ico">'
    page += '<script>' + json.dumps({"page_schema": json.dumps({"props": {"logoURL": image}})}) + '</script>'
    assert extract_logo(source("minimax"), page) == image
    assert extract_logo(source("minimax"), '<link rel="icon" href="/favicon.ico">') is None
    assert extract_logo(source("moonshot"), '<img class="logo" src="/generic-ats.png">') is None


def test_classified_brand_image_wins_over_favicon_and_marketing_art():
    page = '''<link rel="icon" href="/favicon.ico">
      <meta property="og:image" content="https://funimg.pddpic.com/fictional-poster.png">
      <img src="https://funimg.pddpic.com/fictional-poster.png">
      <img alt="logo" src="//funimg.pddpic.com/fictional-brand.png">'''
    assert extract_logo(source("pdd"), page) == "https://funimg.pddpic.com/fictional-brand.png"
    assert extract_logo(source("netease"), '<link rel="shortcut icon" href="/favicon.ico">') == "https://hr.163.com/favicon.ico"
    assert extract_logo(source("netease"), '<meta property="og:image" content="/poster.png">') is None


@pytest.mark.parametrize("value", [
    "http://hr.163.com/brand.png", "https://127.0.0.1/brand.png", "https://internal.example.test/brand.png",
    "https://hr.163.com.evil.example.test/brand.png", "https://user:pass@hr.163.com/brand.png",
    "https://hr.163.com:8443/brand.png", "javascript:alert(1)", "data:image/png;base64,fictional",
    "https://hr.163.com/brand.png\n", "https://hr.163.com\\@evil.example.test/brand.png", "https://[invalid",
])
def test_logo_address_is_https_exact_host_and_browser_safe(value):
    assert safe_logo_url(source("netease"), value) is None


def test_page_paths_are_curated_and_relative_images_use_the_actual_entry():
    assert logo_page(source("baidu")) == "https://talent.baidu.com/jobs/social"
    assert safe_logo_url(source("baidu"), "brand.png") == "https://talent.baidu.com/jobs/brand.png"
    assert safe_logo_url(source("baidu"), "https://talent-fe.cdn.bcebos.com/fictional.png")


@pytest.mark.parametrize("failure", [CollectionError("JOB_SOURCE_HTTP_ERROR"), TimeoutError()])
def test_logo_failure_does_not_change_complete_job_collection(failure):
    class HTTP:
        async def request(self, url, **kwargs):
            assert kwargs["as_text"] is True
            raise failure

    class EmptyJobs(OfficialAdapter):
        async def page(self, *args):
            return [], 0, 50

    entry = source("minimax")
    result = asyncio.run(EmptyJobs(HTTP()).collect(entry.adapter, entry.host, entry.config()))
    assert result.is_complete and result.error_code is None
    assert result.company_logo_url is None and result.company_logo_error_code


def test_logo_is_returned_even_when_jobs_are_temporarily_unavailable():
    class HTTP:
        async def request(self, url, **kwargs):
            if kwargs.get("as_text"):
                return '<link rel="icon" href="/fictional-brand.ico">'
            if kwargs.get("as_bytes"):
                return b"fictional-artwork"
            raise CollectionError("JOB_SOURCE_NETWORK_ERROR")

    entry = source("netease")
    result = asyncio.run(OfficialAdapter(HTTP()).collect(entry.adapter, entry.host, entry.config()))
    assert not result.is_complete and result.error_code == "JOB_SOURCE_NETWORK_ERROR"
    assert result.company_logo_url == "https://hr.163.com/fictional-brand.ico"
    assert result.company_logo_bytes == b"fictional-artwork" and result.company_logo_error_code is None


def moka_page(org='moonshot', site=148506, logo='https://public-cdn.mokahr.com/moonshot/fictional-brand.png'):
    from html import escape
    data = {'siteId': site, 'org': {'id': org, 'webSettings': {'nav': {'logo': {'url': logo}}}}}
    return '<input id="init-data" value="' + escape(json.dumps(data), quote=True) + '">'


def test_moka_tenant_brand_is_read_from_validated_initial_data():
    assert extract_logo(source('moonshot'), moka_page()) == 'https://public-cdn.mokahr.com/moonshot/fictional-brand.png'
    assert extract_logo(source('moonshot'), moka_page(org='another-company')) is None
    assert extract_logo(source('moonshot'), moka_page(site=123)) is None
    assert extract_logo(source('moonshot'), moka_page(logo='https://public-cdn.mokahr.com/another-company/logo.png')) is None
    assert extract_logo(source('moonshot'), moka_page(logo='https://unknown.example.test/logo.png')) is None
    assert extract_logo(source('moonshot'), '<input id="init-data" value="broken-json">') is None


def test_jd_uses_verified_https_brand_icon_without_an_http_redirect():
    class HTTP:
        async def request(self, *args, **kwargs):
            raise AssertionError('fixed verified icon must not request the old HTTP favicon')
    assert asyncio.run(OfficialAdapter(HTTP()).company_logo('jd', 'zhaopin.jd.com')) == 'https://www.jd.com/favicon.ico'


@pytest.mark.parametrize("key", ["byd", "gree", "honor", "hikvision", "xcmg-social", "xcmg-campus"])
def test_new_corporate_marks_do_not_use_generic_ats_favicons_or_arbitrary_hosts(key):
    from linkresume.application.job_pool.logos import FIXED_LOGOS
    entry = source(key)
    class HTTP:
        async def request(self, *args, **kwargs):
            raise AssertionError("verified corporate mark needs no ATS shell")
    assert asyncio.run(OfficialAdapter(HTTP()).company_logo(entry.adapter, entry.host, entry.config())) == FIXED_LOGOS[key]
    assert safe_logo_url(entry, 'https://brand.example.test/company.png') is None
    assert safe_logo_url(entry, FIXED_LOGOS[key].replace('https://', 'http://', 1)) is None


def test_moka_logo_request_enables_only_bounded_same_url_cookie_replay():
    class HTTP:
        async def request(self, url, **kwargs):
            assert url == source('moonshot').url and kwargs['same_url_retry'] is True
            return moka_page()
    assert asyncio.run(OfficialAdapter(HTTP()).company_logo('moka', 'moonshot')) == 'https://public-cdn.mokahr.com/moonshot/fictional-brand.png'


def test_feishu_without_company_artwork_can_use_its_curated_corporate_page():
    assert logo_page(source('zhipu')) == 'https://www.zhipuai.cn/zh'
    assert extract_logo(source('zhipu'), '<img class="logo" src="/fictional-company.svg">') == 'https://www.zhipuai.cn/fictional-company.svg'
    assert extract_logo(source('zhipu'), '<img class="logo" src="https://other.example.test/company.svg">') is None


def test_new_feishu_navigation_logo_excludes_generic_ats_artwork():
    entry = source('dcar')
    image = 'https://lf3-atsx-tob.feishucdn.com/obj/fictional-dcar.png'
    assert extract_logo(entry, json.dumps({'navigation_bar_img_url': image})) == image
    assert extract_logo(entry, json.dumps({'navigation_bar_img_url': 'https://lf3-static.bytednsdoc.com/saas_career/default_logo.png'})) is None


def test_beisen_uses_explicit_tenant_boot_logo_and_never_shell_favicon():
    entry = source('iflytek')
    image = 'https://stcms.beisen.com/fictional-company-logo.png'
    assert extract_logo(entry, '<script>' + json.dumps({'Logo': image}) + '</script>') == image
    assert extract_logo(entry, '<link rel="icon" href="/favicon.ico">') is None
    assert extract_logo(entry, json.dumps({'Logo': 'https://unregistered.example.test/logo.png'})) is None


def test_shared_moka_logo_host_does_not_allow_another_company_path():
    entry = source('sina')
    assert safe_logo_url(entry, 'https://public-cdn.mokahr.com/sina/fictional-logo.png')
    assert safe_logo_url(entry, 'https://public-cdn.mokahr.com/shein/fictional-logo.png') is None


def test_moka_region_logo_requires_its_region_cdn_and_exact_tenant():
    entry = source('vipshop')
    url = 'https://public-cdn-tc.mokahr.com/vipshophr/fictional-logo.png'
    payload = {'siteId': str(entry.site_id), 'org': {'id': entry.host, 'logo': url}}
    from html import escape
    page = '<input id="init-data" value="' + escape(json.dumps(payload), quote=True) + '">'
    assert extract_logo(entry, page) == url
    assert safe_logo_url(entry, 'https://public-cdn-tc.mokahr.com/other-company/fictional-logo.png') is None
    assert safe_logo_url(entry, 'https://public-cdn.mokahr.com/vipshophr/fictional-logo.png') is None
    assert safe_logo_url(source('moonshot'), url) is None

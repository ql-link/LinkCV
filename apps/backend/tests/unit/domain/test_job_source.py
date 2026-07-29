import hashlib

import pytest

from linkcv.domain.job_source import InvalidJobSource, normalize_job_source


def test_boss_mobile_and_desktop_urls_share_one_source_identity() -> None:
    desktop = normalize_job_source(
        "https://www.zhipin.com/job_detail/abc_123.html?ka=search#company"
    )
    mobile = normalize_job_source(
        "http://m.zhipin.com/job_detail/abc_123.html?from=mobile"
    )

    assert desktop == mobile
    assert desktop.site == "boss"
    assert desktop.job_id == "abc_123"
    assert desktop.url == "https://www.zhipin.com/job_detail/abc_123.html"
    assert desktop.url_hash == hashlib.sha256(desktop.url.encode()).digest()


def test_generic_urls_use_stable_web_adapter_and_drop_query_and_fragment() -> None:
    result = normalize_job_source("HTTPS://例子.测试:443/jobs/42?utm_source=test#apply")

    assert result.site == "web"
    assert result.job_id is None
    assert result.url == "https://xn--fsqu00a.xn--0zwm56d/jobs/42"
    assert len(result.url_hash) == 32


def test_generic_ipv6_urls_preserve_valid_bracketed_authority() -> None:
    result = normalize_job_source("https://[::1]:8443/jobs/42?tracking=1")

    assert result.url == "https://[::1]:8443/jobs/42"


@pytest.mark.parametrize(
    "value",
    [
        "",
        "ftp://example.test/jobs/1",
        "https://user:secret@example.test/jobs/1",
        "https://www.zhipin.com/jobs/1",
        "https://www.zhipin.com/job_detail/not.allowed.html",
        "https://exa\n mple.test/jobs/1",
        "https://example.test/jobs/1\x7fignored",
    ],
)
def test_invalid_or_unsafe_sources_are_rejected(value: str) -> None:
    with pytest.raises(InvalidJobSource):
        normalize_job_source(value)

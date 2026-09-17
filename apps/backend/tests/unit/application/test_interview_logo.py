from linkcv.application.interviews.service import application_logo_url
from linkcv.modules.interviews.models import JobApplication


def application_with(logo: object) -> JobApplication:
    return JobApplication(job_snapshot={"logo_url": logo})


def test_https_snapshot_logo_is_projected() -> None:
    application = application_with("https://cdn.example.test/logos/example.png")

    assert application_logo_url(application) == (
        "https://cdn.example.test/logos/example.png"
    )


def test_non_https_snapshot_logo_is_withheld() -> None:
    for logo in (
        "http://cdn.example.test/logos/example.png",
        "//cdn.example.test/logos/example.png",
        "javascript:alert(1)",
        "data:image/svg+xml,<svg/>",
        "",
        None,
        123,
        ["https://cdn.example.test/logos/example.png"],
    ):
        assert application_logo_url(application_with(logo)) is None, logo


def test_missing_snapshot_key_is_withheld() -> None:
    assert application_logo_url(JobApplication(job_snapshot={})) is None

from linkresume.application.interviews.service import application_logo_url
from linkresume.domain.company_logo import company_logo_url
from linkresume.modules.interviews.models import JobApplication


def application_with(logo: object, job_id: int | None = None) -> JobApplication:
    return JobApplication(job_snapshot={"logo_url": logo}, job_description_id=job_id)


def test_https_snapshot_logo_is_projected() -> None:
    application = application_with("https://cdn.example.test/logos/example.png")

    assert application_logo_url(application) == (
        "https://cdn.example.test/logos/example.png"
    )


def test_owned_logo_location_is_projected_only_for_its_own_job() -> None:
    own = company_logo_url(7, "a" * 64)

    assert application_logo_url(application_with(own, 7)) == own
    for logo, job_id in (
        (own, 999),
        (own, None),
        ("/api/assets/private", 7),
        ("//cdn.example.test/logo.png", 7),
    ):
        assert application_logo_url(application_with(logo, job_id)) is None, logo


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

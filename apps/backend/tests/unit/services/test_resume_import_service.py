import pytest

from linkcv.services.resume_import_service import (
    ResumeImportFailure,
    ResumeImportService,
    safe_import_filename,
    validate_import_file,
)


def test_file_validation_and_safe_filename_are_side_effect_free() -> None:
    assert safe_import_filename(" C:/fakepath/resume.md ") == "resume.md"
    assert validate_import_file(
        filename="resume.md",
        content_type="text/markdown",
        content=b"# Resume",
        max_bytes=1024,
    ) == "md"
    with pytest.raises(ResumeImportFailure) as error:
        validate_import_file(
            filename="resume.md",
            content_type="text/markdown",
            content=b"",
            max_bytes=1024,
        )
    assert error.value.code == "EMPTY_IMPORT_FILE"

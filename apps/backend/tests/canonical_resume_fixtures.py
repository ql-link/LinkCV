from linkcv.domain.resume.legacy_cutover import (
    blank_canonical_document,
    convert_legacy_document,
    convert_legacy_template,
    presentation_for_legacy,
)
from linkcv.domain.resume_document import ResumeDocument, default_resume_document
from linkcv.domain.resume_style import ResumePresentation, default_resume_style


def canonical_template_payload(
    *,
    key: str = "classic-cn",
    style: ResumePresentation | None = None,
) -> tuple[dict, dict]:
    legacy_style = style or default_resume_style().model_copy(
        update={"template_key": key}
    )
    definition = convert_legacy_template(legacy_style, template_key=key)
    return (
        blank_canonical_document(seed=key).model_dump(mode="json"),
        definition.model_dump(mode="json"),
    )


def canonical_resume_payload(
    *,
    document: ResumeDocument | None = None,
    style: ResumePresentation | None = None,
    key: str = "classic-cn",
) -> tuple[dict, dict]:
    legacy_style = style or default_resume_style().model_copy(
        update={"template_key": key}
    )
    definition = convert_legacy_template(legacy_style, template_key=key)
    canonical = convert_legacy_document(document or default_resume_document())
    presentation = presentation_for_legacy(legacy_style, definition)
    return canonical.model_dump(mode="json"), presentation.model_dump(mode="json")

from enum import StrEnum


class ImportWarning(StrEnum):
    PDF_OCR_APPLIED = "pdf_ocr_applied"
    PDF_LOW_TEXT_QUALITY = "pdf_low_text_quality"
    DOCX_EMBEDDED_IMAGES_OMITTED = "docx_embedded_images_omitted"
    DOCX_TEXTBOX_ORDER_MAY_CHANGE = "docx_textbox_order_may_change"
    DOCUMENT_HEADING_STRUCTURE_MISSING = "document_heading_structure_missing"
    SOURCE_QUOTE_NOT_FOUND = "source_quote_not_found"
    UNPARSED_WORK_START_DATE = "unparsed_work_start_date"
    UNPARSED_WORK_END_DATE = "unparsed_work_end_date"
    UNMAPPED_FRAGMENTS_PRESERVED = "unmapped_fragments_preserved"


def merge_import_warnings(*groups: list[str]) -> list[str]:
    allowed = {warning.value for warning in ImportWarning}
    merged: list[str] = []
    for group in groups:
        for warning in group:
            if warning in allowed and warning not in merged:
                merged.append(warning)
    return merged

import asyncio
from io import BytesIO
from time import monotonic
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
import pypdfium2 as pdfium
from PIL import Image

from linkcv.domain.document_conversion import DocumentMarkdownResult, PdfLayoutBlock
from linkcv.domain.resume import SparseResumeAnnotations
from linkcv.domain.resume_extraction import ResumeExtractionDraft
from linkcv.services.resume_import_service import (
    ResumeImportFailure,
    ResumeImportService,
    safe_import_filename,
    validate_conversion_layout,
    validate_import_file,
)


DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def docx_fixture(
    *, document_content: bytes = b"<w:document />", header_content: bytes | None = None
) -> bytes:
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", b"<Types />")
        archive.writestr("word/document.xml", document_content)
        if header_content is not None:
            archive.writestr("word/header1.xml", header_content)
    return output.getvalue()


def pdf_with_image_fixture() -> bytes:
    image_bytes = BytesIO()
    Image.new("RGB", (2, 2), "white").save(image_bytes, format="JPEG")
    image_bytes.seek(0)
    document = pdfium.PdfDocument.new()
    page = document.new_page(100, 100)
    image = pdfium.PdfImage.new(document)
    image.load_jpeg(image_bytes)
    image.set_matrix(pdfium.PdfMatrix(10, 0, 0, 10, 10, 10))
    page.insert_obj(image)
    page.gen_content()
    output = BytesIO()
    document.save(output)
    page.close()
    document.close()
    return output.getvalue()


def pdf_without_image_fixture() -> bytes:
    document = pdfium.PdfDocument.new()
    page = document.new_page(100, 100)
    output = BytesIO()
    document.save(output)
    page.close()
    document.close()
    return output.getvalue()


class FakeConverter:
    def __init__(
        self,
        markdown: str = "# 测试者\n\n## 专业技能\nPython",
        *,
        source_format: str = "md",
        warnings: list[str] | None = None,
        layout_hints: list[PdfLayoutBlock] | None = None,
        layout_applied: bool = False,
        layout_schema_version: int | None = None,
    ) -> None:
        self.markdown = markdown
        self.source_format = source_format
        self.warnings = warnings or []
        self.layout_hints = layout_hints
        self.layout_applied = layout_applied
        self.layout_schema_version = layout_schema_version
        self.request_pdf_layout_calls: list[bool] = []

    async def convert(
        self,
        *,
        filename: str,
        request_pdf_layout: bool = False,
        **_kwargs,
    ) -> DocumentMarkdownResult:
        self.request_pdf_layout_calls.append(request_pdf_layout)
        return DocumentMarkdownResult(
            markdown=self.markdown,
            source_file_name=filename,
            source_format=self.source_format,
            parser="fake",
            parser_version="1",
            warnings=self.warnings,
            layout_applied=self.layout_applied,
            layout_schema_version=self.layout_schema_version,
            layout_hints=self.layout_hints,
        )


class MappingStructuringClient:
    def __init__(self) -> None:
        self.received_layout_hints = None

    async def extract_sparse(self, *, source_graph, **_kwargs) -> SparseResumeAnnotations:
        self.received_layout_hints = _kwargs.get("layout_hints")
        return SparseResumeAnnotations(
            schema_version="sparse-resume-annotations.v1",
            source_graph_sha256=source_graph.graph_sha256(),
            annotations=[],
        )


class LegacyStructuringClient:
    async def extract_sparse(self, **_kwargs) -> ResumeExtractionDraft:
        return ResumeExtractionDraft(basics={"name": "测试者"})


class SparseStructuringClient:
    def __init__(self) -> None:
        self.graph = None
        self.layout_hints = None

    async def extract_sparse(self, *, source_graph, timeout_seconds, layout_hints=None, **_kwargs):
        self.graph = source_graph
        self.layout_hints = layout_hints
        return SparseResumeAnnotations(
            schema_version="sparse-resume-annotations.v1",
            source_graph_sha256=source_graph.graph_sha256(),
            annotations=[],
        )


def test_file_validation_and_safe_filename_are_side_effect_free() -> None:
    assert safe_import_filename(" C:/fakepath/resume.md ") == "resume.md"
    assert (
        validate_import_file(
            filename="resume.md",
            content_type="text/markdown",
            content=b"# Resume",
            max_bytes=1024,
        )
        == "md"
    )
    with pytest.raises(ResumeImportFailure) as error:
        validate_import_file(
            filename="resume.md",
            content_type="text/markdown",
            content=b"",
            max_bytes=1024,
        )
    assert error.value.code == "EMPTY_IMPORT_FILE"


def test_markdown_unsupported_layout_is_rejected_but_linkparse_marker_is_allowed() -> (
    None
):
    for content in (
        b"# Resume\n\n![photo](https://example.invalid/photo.png)",
        b"# Resume\n\n| a | b |\n| --- | --- |\n| 1 | 2 |",
        b"# Resume\n\n<iframe>content</iframe>",
    ):
        with pytest.raises(ResumeImportFailure) as error:
            validate_import_file(
                filename="resume.md",
                content_type="text/markdown",
                content=content,
                max_bytes=1024 * 1024,
            )
        assert error.value.code == "RESUME_LAYOUT_UNSUPPORTED"

    assert (
        validate_import_file(
            filename="resume.md",
            content_type="text/markdown",
            content="# Resume\n\n<!-- linkparse: page 1 -->\n正文".encode(),
            max_bytes=1024,
        )
        == "md"
    )


def test_markdown_commonmark_autolinks_are_not_mistaken_for_html() -> None:
    content = (
        "# Resume\n\n"
        "网站：<https://example.invalid/profile> ｜ "
        "邮箱：<test@example.invalid>\n\n"
        "Object Storage 与 embedding model 经验"
    ).encode()

    assert (
        validate_import_file(
            filename="resume.md",
            content_type="text/markdown",
            content=content,
            max_bytes=1024,
        )
        == "md"
    )


def test_docx_validation_rejects_lossy_xml_in_main_and_header_parts() -> None:
    for content in (b"<w:document><w:tbl /></w:document>", b"<w:document />"):
        kwargs = {"document_content": content}
        if content == b"<w:document />":
            kwargs["header_content"] = b"<w:hdr><w:drawing /></w:hdr>"
        with pytest.raises(ResumeImportFailure) as error:
            validate_import_file(
                filename="resume.docx",
                content_type=DOCX_MIME,
                content=docx_fixture(**kwargs),
                max_bytes=2 * 1024 * 1024,
            )
        assert error.value.code == "RESUME_LAYOUT_UNSUPPORTED"


def test_docx_validation_accepts_required_zip_structure() -> None:
    assert (
        validate_import_file(
            filename="resume.docx",
            content_type=DOCX_MIME,
            content=docx_fixture(),
            max_bytes=2 * 1024 * 1024,
        )
        == "docx"
    )


def test_pdf_text_conversion_rejects_embedded_images_that_would_be_omitted() -> None:
    conversion = DocumentMarkdownResult(
        markdown="# Resume\n\n正文",
        source_file_name="resume.pdf",
        source_format="pdf",
        parser="fake",
        parser_version="1",
        detected_type="text_pdf",
        layout_applied=True,
        layout_schema_version=1,
    )

    with pytest.raises(ResumeImportFailure) as error:
        validate_conversion_layout(
            conversion,
            source_content=pdf_with_image_fixture(),
        )

    assert error.value.code == "RESUME_LAYOUT_UNSUPPORTED"


def test_pdf_text_conversion_accepts_proven_image_free_source() -> None:
    conversion = DocumentMarkdownResult(
        markdown="# Resume\n\n正文",
        source_file_name="resume.pdf",
        source_format="pdf",
        parser="fake",
        parser_version="1",
        detected_type="text_pdf",
        layout_applied=True,
        layout_schema_version=1,
    )

    validate_conversion_layout(
        conversion,
        source_content=pdf_without_image_fixture(),
    )


def test_pdf_text_conversion_fails_closed_when_image_inspection_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversion = DocumentMarkdownResult(
        markdown="# Resume\n\n正文",
        source_file_name="resume.pdf",
        source_format="pdf",
        parser="fake",
        parser_version="1",
        detected_type="text_pdf",
        layout_applied=True,
        layout_schema_version=1,
    )

    def fail_inspection(_content: bytes):
        raise RuntimeError("inspection unavailable")

    monkeypatch.setattr(pdfium, "PdfDocument", fail_inspection)
    with pytest.raises(ResumeImportFailure) as error:
        validate_conversion_layout(conversion, source_content=b"%PDF-valid-upstream")
    assert error.value.code == "RESUME_LAYOUT_UNSUPPORTED"


def test_pdf_text_conversion_fails_closed_when_page_enumeration_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversion = DocumentMarkdownResult(
        markdown="# Resume\n\n正文",
        source_file_name="resume.pdf",
        source_format="pdf",
        parser="fake",
        parser_version="1",
        detected_type="text_pdf",
        layout_applied=True,
        layout_schema_version=1,
    )

    class BrokenPage:
        def get_objects(self, **_kwargs):
            raise RuntimeError("enumeration unavailable")

        def close(self) -> None:
            pass

    class BrokenDocument:
        def __len__(self) -> int:
            return 1

        def __getitem__(self, _index: int) -> BrokenPage:
            return BrokenPage()

        def close(self) -> None:
            pass

    monkeypatch.setattr(pdfium, "PdfDocument", lambda _content: BrokenDocument())
    with pytest.raises(ResumeImportFailure) as error:
        validate_conversion_layout(conversion, source_content=b"%PDF-valid-upstream")
    assert error.value.code == "RESUME_LAYOUT_UNSUPPORTED"


def test_pdf_import_without_layout_uses_markdown_fallback() -> None:
    conversion = DocumentMarkdownResult(
        markdown="# 张三\n\n项目经历",
        source_file_name="resume.pdf",
        source_format="pdf",
        parser="fake",
        parser_version="1",
    )

    validate_conversion_layout(conversion)


def test_scanned_pdf_and_low_quality_warning_do_not_gate_markdown_import() -> None:
    conversion = DocumentMarkdownResult(
        markdown="# 张三\n\n" + "可验证的 OCR 正文" * 20,
        source_file_name="resume.pdf",
        source_format="pdf",
        parser="fake",
        parser_version="1",
        detected_type="scanned_pdf",
        ocr_applied=True,
        warnings=["pdf_ocr_applied"],
        layout_applied=True,
        layout_schema_version=1,
    )
    validate_conversion_layout(conversion)

    missing_version = conversion.model_copy(update={"layout_schema_version": None})
    validate_conversion_layout(missing_version)

    low_quality = conversion.model_copy(update={"warnings": ["pdf_low_text_quality"]})
    validate_conversion_layout(low_quality)


def test_pdf_layout_metadata_is_not_required_for_markdown_import() -> None:
    conversion = DocumentMarkdownResult(
        markdown="# 张三\n\n" + "可验证的 PDF 正文" * 20,
        source_file_name="resume.pdf",
        source_format="pdf",
        parser="fake",
        parser_version="1",
        layout_applied=True,
        layout_schema_version=1,
    )

    validate_conversion_layout(conversion)


def test_docx_validation_rejects_encrypted_compound_document() -> None:
    encrypted = bytes.fromhex("D0CF11E0A1B11AE1") + b"".join(
        value.encode("utf-16le") for value in ("EncryptedPackage", "EncryptionInfo")
    )

    with pytest.raises(ResumeImportFailure) as error:
        validate_import_file(
            filename="resume.docx",
            content_type=DOCX_MIME,
            content=encrypted,
            max_bytes=1024,
        )

    assert error.value.status_code == 422
    assert error.value.code == "IMPORT_CONTENT_INVALID"


def test_docx_validation_rejects_compression_bomb() -> None:
    compressed = docx_fixture(document_content=b"x" * (1024 * 1024 + 1))

    with pytest.raises(ResumeImportFailure) as error:
        validate_import_file(
            filename="resume.docx",
            content_type=DOCX_MIME,
            content=compressed,
            max_bytes=2 * 1024 * 1024,
        )

    assert error.value.status_code == 413
    assert error.value.code == "IMPORT_FILE_TOO_LARGE"


def test_conversion_layout_rejects_stale_converter_markdown_for_any_source_format() -> (
    None
):
    conversion = DocumentMarkdownResult(
        markdown="# Resume\n\n| a | b |\n| --- | --- |\n| 1 | 2 |",
        source_file_name="resume.pdf",
        source_format="pdf",
        parser="fake",
        parser_version="1",
    )
    with pytest.raises(ResumeImportFailure) as error:
        validate_conversion_layout(conversion)
    assert error.value.code == "RESUME_LAYOUT_UNSUPPORTED"


def test_parse_resume_composes_canonical_document_and_passes_recipe() -> None:
    converter = FakeConverter()
    structuring = MappingStructuringClient()
    service = ResumeImportService(
        document_converter=converter,
        structuring_client=structuring,
        max_structuring_bytes=10_000,
        structuring_timeout_seconds=30,
    )
    archived: list[str] = []

    async def archive(markdown: str) -> None:
        archived.append(markdown)

    result = asyncio.run(
        service.parse_resume(
            user_id=1,
            filename="resume.md",
            content_type="text/markdown",
            content=b"# source",
            operation_id="task-1",
            deadline_monotonic=monotonic() + 60,
            on_markdown_extracted=archive,
        )
    )

    assert archived == [result.extracted_markdown]
    assert converter.request_pdf_layout_calls == [True]
    assert result.document.identity.name is not None
    assert result.document.identity.name.value == "测试者"
    assert [section.title.value for section in result.document.sections if section.title] == [
        "专业技能"
    ]
    assert "未分类内容" not in str(result.document.model_dump())


def test_parse_resume_passes_only_safe_pdf_layout_hints_to_structuring() -> None:
    blocks = [
        PdfLayoutBlock(
            block_id="line-0",
            source_order=0,
            source_page=1,
            role="heading",
            heading_level=1,
            text="测试者",
            bbox=(0.1, 0.1, 0.4, 0.12),
            confidence=0.99,
            role_source="opendataloader",
        ),
        PdfLayoutBlock(
            block_id="line-1",
            source_order=1,
            source_page=1,
            role="paragraph",
            text="## 专业技能",
            bbox=(0.1, 0.2, 0.4, 0.22),
            confidence=0.98,
            role_source="opendataloader",
        ),
    ]
    converter = FakeConverter(
        source_format="pdf",
        layout_hints=blocks,
        # Hints can still be useful when the strict deterministic layout
        # reconstruction was rejected; they are independent advisory input.
        layout_applied=False,
        layout_schema_version=None,
    )
    structuring = MappingStructuringClient()
    service = ResumeImportService(
        document_converter=converter,
        structuring_client=structuring,
        max_structuring_bytes=10_000,
        structuring_timeout_seconds=30,
    )

    asyncio.run(
        service.parse_resume(
            user_id=1,
            filename="resume.pdf",
            content_type="application/pdf",
            content=b"%PDF-fixture",
            operation_id="task-layout-hints",
            deadline_monotonic=monotonic() + 60,
        )
    )

    assert structuring.received_layout_hints == blocks


def test_parse_resume_rejects_legacy_typed_draft_in_composition_stage() -> None:
    service = ResumeImportService(
        document_converter=FakeConverter(),
        structuring_client=LegacyStructuringClient(),
        max_structuring_bytes=10_000,
        structuring_timeout_seconds=30,
    )

    with pytest.raises(ResumeImportFailure) as raised:
        asyncio.run(
            service.parse_resume(
                user_id=1,
                filename="resume.md",
                content_type="text/markdown",
                content=b"# source",
                operation_id="task-2",
                deadline_monotonic=monotonic() + 60,
            )
        )

    assert raised.value.code == "RESUME_STRUCTURE_INVALID"
    assert raised.value.stage == "model_response_validation"


def test_parse_resume_builds_full_source_graph_for_sparse_runtime() -> None:
    converter = FakeConverter(markdown="# 张三\n\n## 教育经历\n\n示例大学")
    structuring = SparseStructuringClient()
    service = ResumeImportService(
        document_converter=converter,
        structuring_client=structuring,
        max_structuring_bytes=10_000,
        structuring_timeout_seconds=30,
    )

    result = asyncio.run(
        service.parse_resume(
            user_id=1,
            filename="resume.md",
            content_type="text/markdown",
            content=b"source-bytes",
            operation_id="task-sparse",
            deadline_monotonic=monotonic() + 60,
        )
    )

    assert result.source_graph is structuring.graph
    assert result.source_graph is not None
    assert [leaf.text for leaf in result.source_graph.leaves] == [
        "张三", "教育经历", "示例大学"
    ]
    assert [section.title.value for section in result.document.sections if section.title] == [
        "教育经历"
    ]

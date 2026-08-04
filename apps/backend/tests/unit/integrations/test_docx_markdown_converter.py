from io import BytesIO
from zipfile import ZipFile

from linkcv.integrations.docx_markdown_converter import convert_docx_to_markdown


def docx_fixture(*, image: bool = False, textbox: bool = False) -> bytes:
    body = """
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>张三</w:t></w:r></w:p>
      <w:p><w:r><w:t>后端工程师</w:t></w:r></w:p>
      <w:p><w:r><w:t>Python</w:t></w:r></w:p>
    """
    if textbox:
        body += "<w:txbxContent><w:p><w:r><w:t>文本框</w:t></w:r></w:p></w:txbxContent>"
    document = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>{body}</w:body>
    </w:document>"""
    content_types = """<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>"""
    relationships = """<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>"""
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", relationships)
        archive.writestr("word/document.xml", document)
        if image:
            archive.writestr("word/media/image.png", b"not-returned")
    return output.getvalue()


def test_docx_converter_preserves_text_and_omits_embedded_images() -> None:
    markdown, warnings = convert_docx_to_markdown(docx_fixture(image=True))

    assert "张三" in markdown
    assert "后端工程师" in markdown
    assert "Python" in markdown
    assert "data:" not in markdown
    assert "about:blank" not in markdown
    assert warnings == ["docx_embedded_images_omitted"]


def test_docx_converter_warns_when_textbox_order_may_change() -> None:
    _markdown, warnings = convert_docx_to_markdown(docx_fixture(textbox=True))

    assert warnings == ["docx_textbox_order_may_change"]

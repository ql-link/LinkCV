from __future__ import annotations

from io import BytesIO
from zipfile import ZipFile

import mammoth
import nh3
from markdownify import markdownify

from linkcv.domain.import_warnings import ImportWarning

STYLE_MAP = """
p[style-name='Title'] => h1:fresh
p[style-name='Heading 1'] => h1:fresh
p[style-name='Heading 2'] => h2:fresh
p[style-name='Heading 3'] => h3:fresh
"""
ALLOWED_TAGS = {
    "a",
    "br",
    "em",
    "h1",
    "h2",
    "h3",
    "li",
    "ol",
    "p",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
}


def convert_docx_to_markdown(content: bytes) -> tuple[str, list[str]]:
    warnings: list[str] = []
    with ZipFile(BytesIO(content)) as archive:
        names = archive.namelist()
        if any(
            name.startswith("word/media/") and not name.endswith("/")
            for name in names
        ):
            warnings.append(ImportWarning.DOCX_EMBEDDED_IMAGES_OMITTED.value)
        if b"txbxContent" in archive.read("word/document.xml"):
            warnings.append(ImportWarning.DOCX_TEXTBOX_ORDER_MAY_CHANGE.value)

    def omit_image(_image):
        return {"src": "about:blank"}

    result = mammoth.convert_to_html(
        BytesIO(content),
        style_map=STYLE_MAP,
        include_embedded_style_map=False,
        external_file_access=False,
        convert_image=mammoth.images.img_element(omit_image),
    )
    cleaned = nh3.clean(
        result.value,
        tags=ALLOWED_TAGS,
        attributes={"a": {"href"}},
        url_schemes={"http", "https", "mailto"},
        strip_comments=True,
    )
    markdown = markdownify(cleaned, heading_style="ATX", bullets="-")
    return "\n".join(line.rstrip() for line in markdown.splitlines()).strip(), warnings

from __future__ import annotations

import importlib.util
from pathlib import Path

from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_style import ResumePresentation, default_template_manifest

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT / "migrations" / "versions" / "0047_bind_canonical_resume_templates.py"
)


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0047", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Rows:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self._rows = rows

    def mappings(self) -> _Rows:
        return self

    def all(self) -> list[dict[str, object]]:
        return self._rows


class _Connection:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self._rows = rows

    def execute(self, _statement: object) -> _Rows:
        return _Rows(self._rows)


def test_template_cutover_preserves_default_content() -> None:
    revision = load_revision()
    data = default_resume_document().model_dump(mode="json")
    data["basics"]["name"] = "张三"
    data["basics"]["headline"] = "平台工程师"
    style = ResumePresentation(
        template_key="classic-technical-cn",
        manifest=default_template_manifest(),
    ).model_dump(mode="json")

    _, _, _, converted = revision._template_rows(
        _Connection(
            [
                {
                    "id": 8,
                    "key": "classic-technical-cn",
                    "data_json": data,
                    "style_json": style,
                }
            ]
        )
    )

    canonical_data, definition = converted[8]
    assert canonical_data["identity"]["name"]["value"] == "张三"
    assert canonical_data["identity"]["headline"]["value"] == "平台工程师"
    assert definition["template_key"] == "classic-technical-cn"

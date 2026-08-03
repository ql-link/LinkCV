from __future__ import annotations

import json
import sys
from pathlib import Path

from linkcv.integrations.docx_markdown_converter import convert_docx_to_markdown


def main() -> int:
    if len(sys.argv) != 3:
        return 2
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    try:
        markdown, warnings = convert_docx_to_markdown(input_path.read_bytes())
        payload = {"ok": True, "markdown": markdown, "warnings": warnings}
    except Exception as error:
        payload = {"ok": False, "error_type": type(error).__name__}
    output_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

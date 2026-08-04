from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic

from linkcv.domain.document_conversion import DocumentConversionFailure


class DocxParseRunner:
    def __init__(self, timeout_seconds: float = 30.0) -> None:
        self._timeout_seconds = timeout_seconds

    async def convert(
        self,
        content: bytes,
        *,
        deadline_monotonic: float,
    ) -> tuple[str, list[str]]:
        try:
            return await self._convert(
                content,
                deadline_monotonic=deadline_monotonic,
            )
        except (DocumentConversionFailure, asyncio.CancelledError):
            raise
        except OSError as error:
            raise DocumentConversionFailure(
                502, "DOCUMENT_CONVERSION_FAILED"
            ) from error

    async def _convert(
        self,
        content: bytes,
        *,
        deadline_monotonic: float,
    ) -> tuple[str, list[str]]:
        remaining = deadline_monotonic - monotonic()
        if remaining <= 0:
            raise DocumentConversionFailure(504, "IMPORT_DEADLINE_EXCEEDED")
        with TemporaryDirectory(prefix="linkcv-docx-") as temp_dir:
            input_path = Path(temp_dir) / "input.docx"
            output_path = Path(temp_dir) / "result.json"
            input_path.write_bytes(content)
            creationflags = (
                subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
            )
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                "linkcv.integrations.docx_parse_worker",
                str(input_path),
                str(output_path),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
                creationflags=creationflags,
            )
            try:
                _, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=min(self._timeout_seconds, remaining),
                )
            except TimeoutError as error:
                process.kill()
                await process.wait()
                raise DocumentConversionFailure(
                    504, "DOCUMENT_CONVERSION_TIMEOUT"
                ) from error
            except asyncio.CancelledError:
                process.kill()
                await process.wait()
                raise
            if process.returncode != 0 or not output_path.is_file():
                del stderr
                raise DocumentConversionFailure(422, "IMPORT_CONTENT_INVALID")
            try:
                payload = json.loads(output_path.read_text(encoding="utf-8"))
                markdown = payload["markdown"]
                warnings = payload["warnings"]
                if (
                    payload.get("ok") is not True
                    or not isinstance(markdown, str)
                    or not isinstance(warnings, list)
                ):
                    raise ValueError("invalid worker result")
                return markdown, [item for item in warnings if isinstance(item, str)]
            except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
                raise DocumentConversionFailure(422, "IMPORT_CONTENT_INVALID") from error

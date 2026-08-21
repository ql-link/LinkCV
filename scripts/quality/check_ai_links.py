#!/usr/bin/env python3
"""Validate repository AI entry-point links."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "setup" / "setup_ai_links.py"


def main() -> int:
    result = subprocess.run([sys.executable, str(SCRIPT), "--check"], check=False)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())

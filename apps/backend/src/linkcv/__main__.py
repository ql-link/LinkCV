"""Command-line entrypoint for local LinkCV development."""

import uvicorn

from linkcv.core.config import load_settings


def main() -> None:
    settings = load_settings()
    uvicorn.run(
        "linkcv.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=settings.app_environment == "development",
    )


if __name__ == "__main__":
    main()

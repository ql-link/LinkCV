"""Command-line entrypoint for local LinkResume development."""

import uvicorn

from linkresume.core.config import load_settings


def main() -> None:
    settings = load_settings()
    uvicorn.run(
        "linkresume.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=settings.app_environment == "development",
        access_log=False,
    )


if __name__ == "__main__":
    main()

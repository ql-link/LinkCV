"""Command-line entrypoint for local DrawOffer development."""

import uvicorn

from drawoffer.core.config import load_settings


def main() -> None:
    settings = load_settings()
    uvicorn.run(
        "drawoffer.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=settings.app_environment == "development",
        access_log=False,
    )


if __name__ == "__main__":
    main()

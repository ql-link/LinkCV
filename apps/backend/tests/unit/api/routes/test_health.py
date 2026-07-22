from linkcv.api.routes.health import health


def test_health_response_values() -> None:
    response = health()

    assert response.model_dump() == {
        "status": "ok",
        "service": "linkcv-backend",
        "version": "0.1.0",
    }

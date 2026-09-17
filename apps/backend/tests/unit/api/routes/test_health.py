from linkresume.api.routes.health import health


def test_health_response_values() -> None:
    response = health()

    assert response.model_dump() == {
        "status": "ok",
        "service": "linkresume-backend",
        "version": "0.1.0",
    }

from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


def test_health_check():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root_metadata():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {
        "name": "Pomme Studio API",
        "version": "0.1.0",
        "health": "/api/v1/health",
    }

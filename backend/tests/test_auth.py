"""Tests de los endpoints de autenticación: /auth/register y /auth/login."""

import pytest

BASE = "/api/v1/auth"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _register(client, email="test@example.com", password="securepass123", full_name="Test User"):
    return client.post(f"{BASE}/register", json={"email": email, "password": password, "full_name": full_name})


def _login(client, email="test@example.com", password="securepass123"):
    return client.post(f"{BASE}/login", data={"username": email, "password": password})


# ---------------------------------------------------------------------------
# Register
# ---------------------------------------------------------------------------

class TestRegister:
    def test_register_success_returns_201(self, client):
        r = _register(client)
        assert r.status_code == 201

    def test_register_response_has_no_password(self, client):
        r = _register(client)
        body = r.json()
        assert "hashed_password" not in body
        assert "password" not in body

    def test_register_returns_user_fields(self, client):
        r = _register(client, email="fields@example.com")
        body = r.json()
        assert body["email"] == "fields@example.com"
        assert body["is_active"] is True
        assert "id" in body

    def test_register_duplicate_email_returns_409(self, client):
        _register(client, email="dup@example.com")
        r = _register(client, email="dup@example.com")
        assert r.status_code == 409

    def test_register_short_password_returns_422(self, client):
        r = _register(client, password="short")
        assert r.status_code == 422

    def test_register_invalid_email_returns_422(self, client):
        r = _register(client, email="not-an-email")
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

class TestLogin:
    @pytest.fixture(autouse=True)
    def setup_user(self, client):
        _register(client, email="login@example.com", password="mypassword1")

    def test_login_success_returns_200(self, client):
        r = _login(client, email="login@example.com", password="mypassword1")
        assert r.status_code == 200

    def test_login_returns_access_token(self, client):
        r = _login(client, email="login@example.com", password="mypassword1")
        body = r.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"
        assert body["expires_in"] > 0

    def test_login_wrong_password_returns_401(self, client):
        r = _login(client, email="login@example.com", password="wrongpass")
        assert r.status_code == 401

    def test_login_unknown_email_returns_401(self, client):
        r = _login(client, email="nobody@example.com", password="any")
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# /auth/me
# ---------------------------------------------------------------------------

class TestMe:
    def test_me_with_valid_token_returns_200(self, client):
        _register(client, email="me@example.com", password="password123")
        token = _login(client, email="me@example.com", password="password123").json()["access_token"]
        r = client.get(f"{BASE}/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["email"] == "me@example.com"

    def test_me_without_token_returns_401(self, client):
        r = client.get(f"{BASE}/me")
        assert r.status_code == 401

    def test_me_with_invalid_token_returns_401(self, client):
        r = client.get(f"{BASE}/me", headers={"Authorization": "Bearer fake.token.here"})
        assert r.status_code == 401

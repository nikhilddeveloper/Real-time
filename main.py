"""Backward-compatible import for existing ASGI commands."""

from backend.app.main import app, create_app


__all__ = ["app", "create_app"]

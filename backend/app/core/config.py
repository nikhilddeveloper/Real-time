import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_DIR = BACKEND_DIR.parent

load_dotenv(PROJECT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env", override=True)


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_version: str
    openai_api_key: str
    openai_model: str
    whisper_model: str
    transcription_language: str
    transcription_prompt: str
    max_audio_bytes: int
    allowed_audio_suffixes: frozenset[str]
    frontend_origins: tuple[str, ...]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    configured_origins = os.getenv(
        "FRONTEND_ORIGINS",
        os.getenv("FRONTEND_ORIGIN", "http://localhost:3000"),
    )
    origins = {origin.strip() for origin in configured_origins.split(",") if origin.strip()}
    origins.update({"http://localhost:3000", "http://127.0.0.1:3000"})

    return Settings(
        app_name="Practice Room API",
        app_version="1.0.0",
        openai_api_key=os.getenv("OPENAI_API_KEY") or os.getenv("api_key", ""),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-5.6-sol"),
        whisper_model=os.getenv("WHISPER_MODEL", "base"),
        transcription_language=os.getenv("TRANSCRIPTION_LANGUAGE", "en"),
        transcription_prompt=os.getenv(
            "TRANSCRIPTION_PROMPT",
            (
                "Technical software interview question. Python programming language, "
                "project structure, modules, packages, APIs, databases, testing, "
                "configuration, deployment, frontend, and backend."
            ),
        ),
        max_audio_bytes=int(os.getenv("MAX_AUDIO_MB", "25")) * 1024 * 1024,
        allowed_audio_suffixes=frozenset(
            {".wav", ".mp3", ".m4a", ".webm", ".weba", ".ogg", ".flac", ".mp4"}
        ),
        frontend_origins=tuple(sorted(origins)),
    )

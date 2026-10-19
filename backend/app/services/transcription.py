from functools import lru_cache
from pathlib import Path
import shutil
import subprocess
import tempfile

import torch
import whisper

from backend.app.core.config import get_settings


@lru_cache(maxsize=1)
def get_whisper_model():
    return whisper.load_model(get_settings().whisper_model)


def transcribe_audio(path: Path, *, fast: bool = False) -> str:
    settings = get_settings()
    normalized_path: Path | None = None

    try:
        ffmpeg = shutil.which("ffmpeg")
        source_path = path
        if ffmpeg:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
                normalized_path = Path(temp_file.name)
            subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    str(path),
                    "-af",
                    "highpass=f=80,lowpass=f=8000,loudnorm=I=-18:TP=-2:LRA=7",
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    str(normalized_path),
                ],
                check=True,
                capture_output=True,
                timeout=120,
            )
            source_path = normalized_path

        result = get_whisper_model().transcribe(
            str(source_path),
            language=settings.transcription_language,
            task="transcribe",
            initial_prompt=settings.transcription_prompt,
            fp16=torch.cuda.is_available(),
            temperature=0,
            beam_size=1 if fast else 5,
            condition_on_previous_text=False,
        )
    finally:
        if normalized_path is not None:
            normalized_path.unlink(missing_ok=True)

    question = result["text"].strip()
    if not question:
        raise ValueError("No speech was detected in the audio.")
    return question

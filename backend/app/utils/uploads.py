from pathlib import Path

from fastapi import HTTPException, UploadFile

from backend.app.core.config import get_settings


async def save_upload(upload: UploadFile, destination: Path) -> None:
    size = 0
    limit = get_settings().max_audio_bytes

    with destination.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                max_mb = limit // (1024 * 1024)
                raise HTTPException(
                    status_code=413,
                    detail=f"Audio must be smaller than {max_mb} MB.",
                )
            output.write(chunk)

    if size == 0:
        raise HTTPException(status_code=400, detail="The uploaded audio file is empty.")

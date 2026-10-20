import asyncio
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from openai import AuthenticationError, OpenAIError, RateLimitError

from backend.app.core.errors import ConfigurationError
from backend.app.schemas.profile import (
    PracticeAnswerRequest,
    PracticeAnswerResponse,
    ResumeUploadResponse,
)
from backend.app.services.answers import generate_practice_answer
from backend.app.services.resume import SUPPORTED_RESUME_SUFFIXES, extract_resume_text
from backend.app.utils.uploads import save_upload


router = APIRouter(tags=["profile"])


@router.post("/profile/resume", response_model=ResumeUploadResponse)
async def upload_resume(file: UploadFile = File(...)) -> ResumeUploadResponse:
    suffix = Path(file.filename or "resume").suffix.lower()
    if suffix not in SUPPORTED_RESUME_SUFFIXES:
        raise HTTPException(status_code=415, detail="Upload a PDF, DOCX, or TXT resume.")
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = Path(temp_file.name)
        await save_upload(file, temp_path)
        text = await asyncio.to_thread(extract_resume_text, temp_path, suffix)
        return ResumeUploadResponse(
            filename=file.filename or f"resume{suffix}",
            text=text,
            character_count=len(text),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail="The resume could not be read.") from exc
    finally:
        await file.close()
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


@router.post("/profile/practice-answer", response_model=PracticeAnswerResponse)
async def create_practice_answer(request: PracticeAnswerRequest) -> PracticeAnswerResponse:
    try:
        answer = await generate_practice_answer(
            request.question,
            role=request.role,
            instructions=request.resume_text,
            answer_style="concise and truthful",
        )
        return PracticeAnswerResponse(
            question=request.question,
            answer=answer,
            word_count=len(answer.split()),
        )
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RateLimitError as exc:
        raise HTTPException(status_code=503, detail="The configured AI provider has no available API quota.") from exc
    except AuthenticationError as exc:
        raise HTTPException(status_code=503, detail="The configured AI provider key is missing or invalid.") from exc
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail="Could not generate the post-session practice answer.") from exc

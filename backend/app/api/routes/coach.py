import asyncio
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from openai import AuthenticationError, OpenAIError, RateLimitError

from backend.app.core.config import get_settings
from backend.app.core.errors import ConfigurationError
from backend.app.schemas.coach import CoachResponse, NotesRequest, NotesResponse, TextCoachRequest
from backend.app.services.answers import generate_practice_answer, generate_session_notes
from backend.app.services.transcription import transcribe_audio
from backend.app.utils.uploads import save_upload


logger = logging.getLogger(__name__)
router = APIRouter(tags=["coach"])


@router.post("/coach/text", response_model=CoachResponse)
async def coach_text(request: TextCoachRequest) -> CoachResponse:
    try:
        answer = await generate_practice_answer(
            request.question,
            role=request.role[:120],
            company=request.company[:120],
            instructions=request.instructions[:6000],
            answer_style=request.answer_style[:40],
        )
        return CoachResponse(
            question=request.question.strip(),
            answer=answer,
            word_count=len(answer.split()),
        )
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RateLimitError as exc:
        raise HTTPException(status_code=503, detail="The OpenAI account has no available API quota.") from exc
    except OpenAIError as exc:
        logger.exception("OpenAI text coaching request failed")
        raise HTTPException(status_code=502, detail="The answer service is temporarily unavailable.") from exc


@router.post("/coach", response_model=CoachResponse)
async def coach(
    file: UploadFile = File(...),
    role: str = Form("General interview"),
    company: str = Form(""),
    instructions: str = Form(""),
    answer_style: str = Form("concise"),
) -> CoachResponse:
    settings = get_settings()
    suffix = Path(file.filename or "question.webm").suffix.lower()
    if suffix not in settings.allowed_audio_suffixes:
        raise HTTPException(
            status_code=415,
            detail="Use WAV, MP3, M4A, WebM/WEBA, OGG, FLAC, or MP4 audio.",
        )

    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = Path(temp_file.name)

        await save_upload(file, temp_path)
        question = await asyncio.to_thread(transcribe_audio, temp_path)
        answer = await generate_practice_answer(
            question,
            role=role[:120],
            company=company[:120],
            instructions=instructions[:6000],
            answer_style=answer_style[:40],
        )
        return CoachResponse(
            question=question,
            answer=answer,
            word_count=len(answer.split()),
        )
    except HTTPException:
        raise
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RateLimitError as exc:
        raise HTTPException(
            status_code=503,
            detail="The OpenAI account has no available API quota. Check billing and try again.",
        ) from exc
    except AuthenticationError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "OPENAI_API_KEY is missing or invalid. Set a valid key in backend/.env "
                "or the project .env file, then restart the backend."
            ),
        ) from exc
    except OpenAIError as exc:
        logger.exception("OpenAI request failed")
        raise HTTPException(
            status_code=502,
            detail="The answer service is temporarily unavailable. Please try again.",
        ) from exc
    except (OSError, RuntimeError) as exc:
        logger.exception("Audio processing failed")
        raise HTTPException(
            status_code=422,
            detail="The audio could not be decoded or transcribed. Try WAV, MP3, WebM, or WEBA.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected coaching request failure")
        raise HTTPException(
            status_code=500,
            detail="The coach could not process this question.",
        ) from exc
    finally:
        await file.close()
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


@router.post("/notes", response_model=NotesResponse)
async def notes(request: NotesRequest) -> NotesResponse:
    try:
        payload = await generate_session_notes(
            role=request.role[:120],
            company=request.company[:120],
            turns=[turn.model_dump() for turn in request.turns[-20:]],
        )
        return NotesResponse(**payload)
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RateLimitError as exc:
        raise HTTPException(status_code=503, detail="The OpenAI account has no available API quota.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OpenAIError as exc:
        logger.exception("OpenAI notes request failed")
        raise HTTPException(status_code=502, detail="Could not generate session notes.") from exc

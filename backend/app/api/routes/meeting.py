import asyncio
import logging
import re
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from openai import AuthenticationError, OpenAIError, RateLimitError

from backend.app.core.config import get_settings
from backend.app.core.errors import ConfigurationError
from backend.app.schemas.meeting import (
    MeetingInsightsRequest,
    MeetingInsightsResponse,
    MeetingSegmentResponse,
    TranscriptSegmentResponse,
)
from backend.app.services.meeting import analyze_meeting_segment
from backend.app.services.transcription import transcribe_audio
from backend.app.utils.uploads import save_upload


logger = logging.getLogger(__name__)
router = APIRouter(tags=["meeting"])


QUESTION_STARTERS = re.compile(
    r"^(who|what|when|where|why|how|can|could|would|will|do|does|did|is|are|"
    r"should|have|has|tell me|tell us|walk me through|walk us through|explain|"
    r"describe|share an example|give me an example|help me understand)\b",
    re.IGNORECASE,
)


def looks_like_question(text: str) -> bool:
    normalized = text.strip()
    if normalized.endswith("?"):
        return True
    candidates = [part.strip(" .,!:-") for part in re.split(r"[?.!]", normalized) if part.strip()]
    return any(QUESTION_STARTERS.match(candidate) for candidate in candidates[-3:])


@router.post("/meeting/transcribe", response_model=TranscriptSegmentResponse)
async def transcribe_meeting_segment(
    file: UploadFile = File(...),
    previous_text: str = Form(""),
) -> TranscriptSegmentResponse:
    settings = get_settings()
    suffix = Path(file.filename or "segment.webm").suffix.lower()
    if suffix not in settings.allowed_audio_suffixes:
        raise HTTPException(status_code=415, detail="Unsupported meeting audio format.")
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = Path(temp_file.name)
        await save_upload(file, temp_path)
        transcript = await asyncio.to_thread(
            transcribe_audio,
            temp_path,
            fast=True,
            prompt_context=previous_text[-600:],
        )
        return TranscriptSegmentResponse(
            transcript=transcript,
            is_question=looks_like_question(f"{previous_text[-300:]} {transcript}"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, RuntimeError) as exc:
        logger.exception("Fast meeting transcription failed")
        raise HTTPException(status_code=422, detail="The audio segment could not be decoded.") from exc
    finally:
        await file.close()
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


@router.post("/meeting/insights", response_model=MeetingInsightsResponse)
async def meeting_insights(request: MeetingInsightsRequest) -> MeetingInsightsResponse:
    try:
        update = await analyze_meeting_segment(
            request.transcript,
            previous_summary=request.previous_summary,
            meeting_context=request.meeting_context,
        )
        return MeetingInsightsResponse(**update)
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RateLimitError as exc:
        raise HTTPException(status_code=503, detail="The configured AI provider has no available API quota.") from exc
    except AuthenticationError as exc:
        raise HTTPException(status_code=503, detail="The configured AI provider key is missing or invalid.") from exc
    except OpenAIError as exc:
        logger.exception("Meeting insights failed")
        raise HTTPException(status_code=502, detail="The meeting analysis service is unavailable.") from exc


@router.post("/meeting/segment", response_model=MeetingSegmentResponse)
async def process_meeting_segment(
    file: UploadFile = File(...),
    previous_summary: str = Form(""),
    meeting_context: str = Form(""),
) -> MeetingSegmentResponse:
    settings = get_settings()
    suffix = Path(file.filename or "segment.webm").suffix.lower()
    if suffix not in settings.allowed_audio_suffixes:
        raise HTTPException(status_code=415, detail="Unsupported meeting audio format.")

    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = Path(temp_file.name)
        await save_upload(file, temp_path)
        transcript = await asyncio.to_thread(transcribe_audio, temp_path)
        update = await analyze_meeting_segment(
            transcript,
            previous_summary=previous_summary[-6000:],
            meeting_context=meeting_context[:3000],
        )
        return MeetingSegmentResponse(transcript=transcript, **update)
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RateLimitError as exc:
        raise HTTPException(status_code=503, detail="The configured AI provider has no available API quota.") from exc
    except AuthenticationError as exc:
        raise HTTPException(status_code=503, detail="The configured AI provider key is missing or invalid.") from exc
    except OpenAIError as exc:
        logger.exception("Meeting analysis failed")
        raise HTTPException(status_code=502, detail="The meeting analysis service is unavailable.") from exc
    except (OSError, RuntimeError) as exc:
        logger.exception("Meeting audio processing failed")
        raise HTTPException(status_code=422, detail="The audio segment could not be decoded.") from exc
    finally:
        await file.close()
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


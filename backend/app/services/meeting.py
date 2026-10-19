import json

from backend.app.services.answers import get_openai_client
from backend.app.core.config import get_settings


async def analyze_meeting_segment(
    transcript: str,
    *,
    previous_summary: str = "",
    meeting_context: str = "",
) -> dict[str, object]:
    client = get_openai_client()
    settings = get_settings()
    response = await client.responses.create(
        model=settings.openai_model,
        text={
            "format": {
                "type": "json_schema",
                "name": "meeting_update",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string"},
                        "action_items": {"type": "array", "items": {"type": "string"}},
                        "follow_up_questions": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["summary", "action_items", "follow_up_questions"],
                    "additionalProperties": False,
                },
            },
        },
        instructions=(
            "You are a disclosed real-time meeting assistant. Update the concise meeting "
            "summary, extract explicit action items, and suggest useful follow-up questions. "
            "Do not generate interview answers, impersonate a participant, or invent facts."
        ),
        input=(
            f"Meeting context: {meeting_context or 'General meeting'}\n"
            f"Previous rolling summary: {previous_summary or 'None yet'}\n"
            f"New transcript segment: {transcript}"
        ),
        max_output_tokens=500,
    )
    return json.loads(response.output_text)


from functools import lru_cache

from openai import AsyncOpenAI

from backend.app.core.config import get_settings
from backend.app.core.errors import ConfigurationError


MIN_WORDS = 50
MAX_WORDS = 60


@lru_cache(maxsize=1)
def get_openai_client() -> AsyncOpenAI:
    api_key = get_settings().openai_api_key
    if not api_key:
        raise ConfigurationError(
            "Set OPENAI_API_KEY in backend/.env or the project .env file."
        )
    return AsyncOpenAI(api_key=api_key)


async def generate_practice_answer(
    question: str,
    *,
    role: str = "General interview",
    company: str = "",
    instructions: str = "",
    answer_style: str = "concise",
) -> str:
    settings = get_settings()
    client = get_openai_client()
    correction = ""
    answer = ""

    for _ in range(2):
        response = await client.responses.create(
            model=settings.openai_model,
            reasoning={"effort": "none"},
            text={"verbosity": "low"},
            instructions=(
                "You are a mock-interview coach. Draft a confident, truthful practice "
                "answer to the interviewer's question. The answer must contain between "
                "50 and 60 words inclusive. Give only the answer, with no heading, word "
                "count, coaching notes, invented experience, or fabricated credentials. "
                "Use the supplied role, company, and candidate notes only as context; "
                "never invent experience or credentials. "
                + correction
            ),
            input=(
                f"Role: {role}\nCompany: {company or 'Not specified'}\n"
                f"Answer style: {answer_style}\nCandidate notes: {instructions or 'None'}\n"
                f"Practice question: {question}"
            ),
            max_output_tokens=180,
        )
        answer = response.output_text.strip()
        count = len(answer.split())
        if MIN_WORDS <= count <= MAX_WORDS:
            return answer
        correction = (
            f"The previous draft contained {count} words. Rewrite it to contain exactly "
            "55 words while preserving the useful content."
        )

    if not answer:
        raise ValueError("The answer service returned an empty response.")
    return answer


async def generate_session_notes(
    *, role: str, company: str, turns: list[dict[str, str]]
) -> dict[str, object]:
    if not turns:
        raise ValueError("Complete at least one practice question before generating notes.")

    client = get_openai_client()
    settings = get_settings()
    transcript = "\n\n".join(
        f"Question {index + 1}: {turn['question']}\nSuggested practice answer: {turn['answer']}"
        for index, turn in enumerate(turns)
    )
    response = await client.responses.create(
        model=settings.openai_model,
        reasoning={"effort": "none"},
        text={
            "verbosity": "low",
            "format": {
                "type": "json_schema",
                "name": "practice_session_notes",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string"},
                        "strengths": {"type": "array", "items": {"type": "string"}},
                        "improvements": {"type": "array", "items": {"type": "string"}},
                        "next_steps": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["summary", "strengths", "improvements", "next_steps"],
                    "additionalProperties": False,
                },
            },
        },
        instructions=(
            "Create concise coaching notes for a disclosed mock interview. Do not claim "
            "the candidate actually said the suggested answers. Give practical next steps."
        ),
        input=f"Role: {role}\nCompany: {company or 'Not specified'}\n\n{transcript}",
        max_output_tokens=500,
    )
    import json

    return json.loads(response.output_text)

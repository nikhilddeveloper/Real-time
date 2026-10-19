from pydantic import BaseModel, Field


class CoachResponse(BaseModel):
    question: str
    answer: str
    word_count: int = Field(ge=0)


class TextCoachRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    role: str = "General interview"
    company: str = ""
    instructions: str = ""
    answer_style: str = "concise"


class TranscriptTurn(BaseModel):
    question: str
    answer: str


class NotesRequest(BaseModel):
    role: str = "General interview"
    company: str = ""
    turns: list[TranscriptTurn]


class NotesResponse(BaseModel):
    summary: str
    strengths: list[str]
    improvements: list[str]
    next_steps: list[str]


class HealthResponse(BaseModel):
    status: str
    service: str

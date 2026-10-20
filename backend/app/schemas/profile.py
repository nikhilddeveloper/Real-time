from pydantic import BaseModel, Field


class ResumeUploadResponse(BaseModel):
    filename: str
    text: str
    character_count: int = Field(ge=0)


class PracticeAnswerRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    resume_text: str = Field(default="", max_length=20000)
    role: str = Field(default="Candidate", max_length=120)


class PracticeAnswerResponse(BaseModel):
    question: str
    answer: str
    word_count: int = Field(ge=0)

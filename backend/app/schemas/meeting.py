from pydantic import BaseModel, Field


class MeetingSegmentResponse(BaseModel):
    transcript: str
    summary: str
    action_items: list[str] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list)


class TranscriptSegmentResponse(BaseModel):
    transcript: str
    is_question: bool


class MeetingInsightsRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=30000)
    previous_summary: str = Field(default="", max_length=6000)
    meeting_context: str = Field(default="", max_length=3000)


class MeetingInsightsResponse(BaseModel):
    summary: str
    action_items: list[str] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list)


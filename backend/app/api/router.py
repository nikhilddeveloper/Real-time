from fastapi import APIRouter

from backend.app.api.routes.coach import router as coach_router
from backend.app.api.routes.meeting import router as meeting_router
from backend.app.api.routes.profile import router as profile_router


api_router = APIRouter(prefix="/api")
api_router.include_router(coach_router)
api_router.include_router(meeting_router)
api_router.include_router(profile_router)

from fastapi import APIRouter

from backend.app.api.routes.coach import router as coach_router


api_router = APIRouter(prefix="/api")
api_router.include_router(coach_router)

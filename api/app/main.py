from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import get_settings
from app.routers import explain, extract, health, passport, recommend, redact

settings = get_settings()

app = FastAPI(title="NoduleBridge API", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(extract.router)
app.include_router(recommend.router)
app.include_router(explain.router)
app.include_router(passport.router)
app.include_router(redact.router)

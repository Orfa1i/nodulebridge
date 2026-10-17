from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import get_settings
from app.routers import explain, extract, health, passport, recommend, redact
from app.services.seed import seed_extract_cache
from app.webstatic import WebStaticFiles

settings = get_settings()

@asynccontextmanager
async def lifespan(_: FastAPI):
    seed_extract_cache(settings)  # the example reports are served pre-computed, so the first click is warm
    yield


app = FastAPI(title="NoduleBridge API", version=__version__, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.web_origin.split(",") if o.strip()],  # comma separated for several web origins
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(extract.router)
app.include_router(recommend.router)
app.include_router(explain.router)
app.include_router(passport.router)
app.include_router(redact.router)

# last, so every API route above wins: the exported web app (pages, scripts, example scans) when STATIC_DIR is set
if settings.static_dir and settings.static_dir.is_dir():
    app.mount("/", WebStaticFiles(directory=settings.static_dir, html=True), name="web")

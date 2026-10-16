from typing import Annotated

from fastapi import APIRouter, Depends

from app import __version__
from app.config import Settings, get_settings
from app.schemas.health import Health

router = APIRouter()


@router.get("/health", response_model=Health)
def health(settings: Annotated[Settings, Depends(get_settings)]) -> Health:
    return Health(status="ok", version=__version__, model=settings.anthropic_model or None)

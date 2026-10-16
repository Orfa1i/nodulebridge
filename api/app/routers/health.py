from typing import Annotated

from fastapi import APIRouter, Depends

from app import __version__
from app.config import Settings, get_settings
from app.schemas.health import Health
from app.services.extractor import ExtractionUnavailable
from app.services.providers import model_id, resolve_provider

router = APIRouter()


@router.get("/health", response_model=Health)
def health(settings: Annotated[Settings, Depends(get_settings)]) -> Health:
    try:
        provider = resolve_provider(settings)
    except ExtractionUnavailable:
        provider = None
    return Health(
        status="ok",
        version=__version__,
        model=model_id(settings) if provider else None,
        provider=provider,
    )

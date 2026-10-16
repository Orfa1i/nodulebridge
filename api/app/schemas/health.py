from pydantic import BaseModel


class Health(BaseModel):
    status: str
    version: str
    # provider-qualified model id when an LLM key is configured, else None
    model: str | None = None
    provider: str | None = None

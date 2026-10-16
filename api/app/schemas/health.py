from pydantic import BaseModel


class Health(BaseModel):
    status: str
    version: str
    model: str | None = None

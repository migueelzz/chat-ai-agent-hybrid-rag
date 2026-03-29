from datetime import datetime
from pydantic import BaseModel


class CreateSessionResponse(BaseModel):
    session_id: str
    created_at: datetime


class MessageRequest(BaseModel):
    message: str
    skill_names: list[str] = []   # substitui skill_name; lista vazia = sem skill explícita
    web_search_enabled: bool = True


class MessageChunk(BaseModel):
    """Unidade de dado enviada via SSE ao cliente."""
    type: str           # "token" | "tool_start" | "tool_end" | "error" | "done"
    content: str
    tool_name: str | None = None
    is_document: bool = False   # True quando use_skill foi invocado (done event)
    next_skill: str | None = None  # Próxima skill na cadeia (done event)


class ExtractDocumentRequest(BaseModel):
    content: str


class HistoryMessage(BaseModel):
    role: str           # "human" | "assistant" | "tool"
    content: str
    tool_name: str | None = None  # preenchido apenas quando role == "tool"


class HistoryResponse(BaseModel):
    session_id: str
    messages: list[HistoryMessage]

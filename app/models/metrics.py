from datetime import datetime

from pydantic import BaseModel


class DailyCalls(BaseModel):
    date: str   # "YYYY-MM-DD"
    calls: int


class MetricsSummary(BaseModel):
    total_calls: int
    avg_latency_ms: float
    error_count: int


class ErrorLog(BaseModel):
    id: int
    session_id: str | None
    timestamp: datetime
    error_message: str | None
    error_type: str | None
    tool_name: str | None

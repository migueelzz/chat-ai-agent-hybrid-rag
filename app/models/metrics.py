from datetime import datetime

from pydantic import BaseModel


class DailyCalls(BaseModel):
    date: str   # "YYYY-MM-DD"
    calls: int


class MetricsSummary(BaseModel):
    total_calls: int
    avg_latency_ms: float
    error_count: int
    total_spend: float | None       # de LiteLLM /spend/logs (None se proxy indisponível)
    total_tokens: int | None        # de LiteLLM /spend/logs (None se proxy indisponível)


class ProviderBudget(BaseModel):
    provider: str
    budget_limit: float | None
    spend: float
    time_period: str | None
    budget_reset_at: str | None


class ErrorLog(BaseModel):
    id: int
    session_id: str | None
    timestamp: datetime
    error_message: str | None
    error_type: str | None
    tool_name: str | None

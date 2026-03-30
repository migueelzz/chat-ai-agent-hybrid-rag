import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.metrics import DailyCalls, ErrorLog, MetricsSummary, ProviderBudget

router = APIRouter()

_LITELLM_TIMEOUT = 5.0  # segundos — falha silenciosa se proxy indisponível


async def _fetch_litellm_spend() -> tuple[float | None, int | None]:
    """Consulta LiteLLM /spend/logs?summarize=true.
    Retorna (total_spend, total_tokens) ou (None, None) se proxy indisponível.
    Nunca expõe api_key ou request_id individuais.
    """
    if not settings.llm_base_url:
        return None, None
    try:
        async with httpx.AsyncClient(timeout=_LITELLM_TIMEOUT) as client:
            resp = await client.get(
                f"{settings.llm_base_url}/spend/logs",
                params={"summarize": "true"},
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            )
            if resp.status_code != 200:
                return None, None
            rows = resp.json()
            if not isinstance(rows, list):
                return None, None
            total_spend = sum(float(r.get("spend") or 0) for r in rows)
            total_tokens = sum(int(r.get("total_tokens") or 0) for r in rows)
            return round(total_spend, 6), total_tokens
    except Exception:
        return None, None


@router.get("/usage", response_model=list[DailyCalls])
async def get_usage(days: int = 7, db: AsyncSession = Depends(get_db)):
    """Chamadas ao LLM por dia (dados locais)."""
    result = await db.execute(
        text("""
            SELECT
                DATE(timestamp AT TIME ZONE 'UTC') AS date,
                COUNT(*)::int                      AS calls
            FROM chat_usage
            WHERE timestamp >= NOW() - (INTERVAL '1 day' * :days)
            GROUP BY DATE(timestamp AT TIME ZONE 'UTC')
            ORDER BY date
        """),
        {"days": days},
    )
    rows = result.fetchall()
    return [DailyCalls(date=str(r.date), calls=r.calls) for r in rows]


@router.get("/summary", response_model=MetricsSummary)
async def get_summary(days: int = 7, db: AsyncSession = Depends(get_db)):
    """Resumo do período: chamadas + latência (local) e gasto + tokens (LiteLLM)."""
    local_result = await db.execute(
        text("""
            SELECT
                COUNT(*)::int                              AS total_calls,
                COALESCE(AVG(latency_ms), 0)::float       AS avg_latency_ms
            FROM chat_usage
            WHERE timestamp >= NOW() - (INTERVAL '1 day' * :days)
        """),
        {"days": days},
    )
    local_row = local_result.fetchone()

    error_result = await db.execute(
        text("""
            SELECT COUNT(*)::int AS error_count
            FROM chat_errors
            WHERE timestamp >= NOW() - (INTERVAL '1 day' * :days)
        """),
        {"days": days},
    )
    error_row = error_result.fetchone()

    total_spend, total_tokens = await _fetch_litellm_spend()

    return MetricsSummary(
        total_calls=local_row.total_calls if local_row else 0,
        avg_latency_ms=round(local_row.avg_latency_ms if local_row else 0, 1),
        error_count=error_row.error_count if error_row else 0,
        total_spend=total_spend,
        total_tokens=total_tokens,
    )


@router.get("/provider", response_model=list[ProviderBudget])
async def get_provider_budgets():
    """Orçamento por provider (LiteLLM /provider/budgets).
    Retorna lista vazia se proxy indisponível ou sem budgets configurados.
    """
    if not settings.llm_base_url:
        return []
    try:
        async with httpx.AsyncClient(timeout=_LITELLM_TIMEOUT) as client:
            resp = await client.get(
                f"{settings.llm_base_url}/provider/budgets",
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
            providers = data.get("providers") or {}
            return [
                ProviderBudget(
                    provider=name,
                    budget_limit=p.get("budget_limit"),
                    spend=float(p.get("spend") or 0),
                    time_period=p.get("time_period"),
                    budget_reset_at=p.get("budget_reset_at"),
                )
                for name, p in providers.items()
            ]
    except Exception:
        return []


@router.get("/errors", response_model=list[ErrorLog])
async def get_errors(limit: int = 50, db: AsyncSession = Depends(get_db)):
    """Log dos erros mais recentes."""
    result = await db.execute(
        text("""
            SELECT id, session_id, timestamp, error_message, error_type, tool_name
            FROM chat_errors
            ORDER BY timestamp DESC
            LIMIT :limit
        """),
        {"limit": limit},
    )
    rows = result.fetchall()
    return [
        ErrorLog(
            id=r.id,
            session_id=r.session_id,
            timestamp=r.timestamp,
            error_message=r.error_message,
            error_type=r.error_type,
            tool_name=r.tool_name,
        )
        for r in rows
    ]

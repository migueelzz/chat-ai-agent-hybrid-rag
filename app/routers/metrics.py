from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.metrics import DailyCalls, ErrorLog, MetricsSummary

router = APIRouter()


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
    """Resumo do período: chamadas + latência + erros (dados locais)."""
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

    return MetricsSummary(
        total_calls=local_row.total_calls if local_row else 0,
        avg_latency_ms=round(local_row.avg_latency_ms if local_row else 0, 1),
        error_count=error_row.error_count if error_row else 0,
    )


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

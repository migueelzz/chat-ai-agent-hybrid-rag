-- ============================================================
-- Migration: adiciona tabelas de métricas de uso e erros
-- Idempotente — pode ser re-executado sem efeito colateral
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_usage (
    id            SERIAL PRIMARY KEY,
    session_id    TEXT NOT NULL,
    timestamp     TIMESTAMPTZ DEFAULT NOW(),
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    model_name    TEXT,
    latency_ms    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_chat_usage_ts      ON chat_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_chat_usage_session  ON chat_usage(session_id);

CREATE TABLE IF NOT EXISTS chat_errors (
    id            SERIAL PRIMARY KEY,
    session_id    TEXT,
    timestamp     TIMESTAMPTZ DEFAULT NOW(),
    error_message TEXT,
    error_type    TEXT,
    tool_name     TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_errors_ts ON chat_errors(timestamp);

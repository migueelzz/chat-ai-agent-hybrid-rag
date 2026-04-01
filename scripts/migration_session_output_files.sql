-- Migration: criar tabela session_output_files para arquivos gerados pelo agente
-- Idempotente: seguro executar múltiplas vezes

CREATE TABLE IF NOT EXISTS session_output_files (
    id         SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    path       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (session_id, path)
);

CREATE INDEX IF NOT EXISTS idx_session_output_files_session ON session_output_files (session_id);

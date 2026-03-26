-- Tabela para arquivos enviados pelo usuário por sessão de chat
CREATE TABLE IF NOT EXISTS session_files (
  id          SERIAL PRIMARY KEY,
  session_id  TEXT        NOT NULL,
  filename    TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  size_bytes  INTEGER     NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id);

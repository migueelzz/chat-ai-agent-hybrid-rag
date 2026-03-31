-- ============================================================
-- Migration: suporte a anexos PDF e imagem em session_files
-- Idempotente — pode ser re-executado sem efeito colateral
-- ============================================================

-- 1. Tornar content nullable (imagens não têm conteúdo de texto)
ALTER TABLE session_files
    ALTER COLUMN content DROP NOT NULL;

-- 2. Adicionar colunas de metadados e binário
ALTER TABLE session_files
    ADD COLUMN IF NOT EXISTS file_type  VARCHAR(20)  DEFAULT 'text',
    ADD COLUMN IF NOT EXISTS mime_type  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS image_data BYTEA;

-- 3. Backfill: linhas existentes já são do tipo 'text'
UPDATE session_files SET file_type = 'text' WHERE file_type IS NULL;

-- 4. Índice para queries por file_type dentro de uma sessão
CREATE INDEX IF NOT EXISTS idx_session_files_type
    ON session_files(session_id, file_type);

COMMENT ON COLUMN session_files.file_type   IS 'text | pdf | image';
COMMENT ON COLUMN session_files.mime_type   IS 'MIME type validado server-side, ex: application/pdf, image/jpeg';
COMMENT ON COLUMN session_files.image_data  IS 'Dados binários da imagem processada (redimensionada, EXIF removido); NULL para tipos text e pdf';

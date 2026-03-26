-- Adiciona coluna file_size_bytes na tabela sources
ALTER TABLE sources ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT DEFAULT 0;

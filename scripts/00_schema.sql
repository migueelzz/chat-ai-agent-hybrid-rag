-- ============================================================
-- EXTENSÕES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() não é IMMUTABLE por padrão; wrapper necessário para colunas GENERATED
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$SELECT unaccent('unaccent'::regdictionary, $1)$$;

-- ============================================================
-- FONTES (arquivos originais)
-- ============================================================
CREATE TABLE IF NOT EXISTS sources (
    id              SERIAL PRIMARY KEY,
    filename        TEXT NOT NULL UNIQUE,
    modulo          TEXT NOT NULL,           -- 'FI' | 'CO' | 'MM' | 'SD' | 'PP'
    release         TEXT,                    -- ex: 'S/4HANA 2023'
    tipo            TEXT DEFAULT 'pdf',      -- 'pdf' | 'codigo' | 'artefato'
    total_pages     INTEGER,
    file_size_bytes BIGINT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DOCUMENTOS / SEÇÕES (1 por capítulo/seção do PDF)
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
    id          SERIAL PRIMARY KEY,
    source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    page_start  INTEGER NOT NULL,
    page_end    INTEGER NOT NULL,
    raw_text    TEXT NOT NULL,        -- texto completo da seção (SEM embedding)
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_id);

-- ============================================================
-- CHUNKS (unidade de retrieval — TEM embedding)
-- ============================================================
CREATE TABLE IF NOT EXISTS chunks (
    id              SERIAL PRIMARY KEY,
    document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    tokens          INTEGER,
    embedding       VECTOR(384),      -- gerado por MiniLM-L6-v2
    fts             TSVECTOR GENERATED ALWAYS AS (
                        to_tsvector('portuguese', immutable_unaccent(content))
                    ) STORED,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índice vetorial HNSW
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
    ON chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Índice full-text
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON chunks USING gin(fts);

-- Índice trigram (fuzzy)
CREATE INDEX IF NOT EXISTS idx_chunks_trgm ON chunks USING gin(content gin_trgm_ops);

-- ============================================================
-- ENTIDADES SAP (extraídas deterministicamente)
-- ============================================================
CREATE TABLE IF NOT EXISTS entities (
    id          SERIAL PRIMARY KEY,
    chunk_id    INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL,  -- 'tabela'|'campo'|'transacao'|'cds'|'termo'
    valor       TEXT NOT NULL,
    contexto    TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entities_chunk ON entities(chunk_id);
CREATE INDEX IF NOT EXISTS idx_entities_valor ON entities USING gin(valor gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_tipo  ON entities(tipo);

-- ============================================================
-- ALIASES (sinônimos e abreviações SAP)
-- ============================================================
CREATE TABLE IF NOT EXISTS aliases (
    id          SERIAL PRIMARY KEY,
    termo       TEXT NOT NULL,
    alias       TEXT NOT NULL,
    modulo      TEXT,
    UNIQUE(termo, alias)
);

INSERT INTO aliases(termo, alias, modulo) VALUES
    ('nota fiscal',         'NF',      'MM'),
    ('pedido de compra',    'PO',      'MM'),
    ('ordem de venda',      'SO',      'SD'),
    ('lançamento contábil', 'posting', 'FI'),
    ('centro de custo',     'CC',      'CO'),
    ('documento contábil',  'FI doc',  'FI')
ON CONFLICT (termo, alias) DO NOTHING;

-- ============================================================
-- CATÁLOGO SAP (transações e objetos conhecidos)
-- ============================================================
CREATE TABLE IF NOT EXISTS sap_catalog (
    id          SERIAL PRIMARY KEY,
    tipo        TEXT NOT NULL,   -- 'transacao'|'tabela'|'cds'|'bapi'
    codigo      TEXT NOT NULL UNIQUE,
    descricao   TEXT,
    modulo      TEXT
);

INSERT INTO sap_catalog(tipo, codigo, descricao, modulo) VALUES
    ('transacao', 'FB01',  'Lançar documento',           'FI'),
    ('transacao', 'FB50',  'Lançar documento G/L',       'FI'),
    ('transacao', 'FS10N', 'Saldo da conta G/L',         'FI'),
    ('tabela',    'BKPF',  'Cabeçalho do documento FI',  'FI'),
    ('tabela',    'BSEG',  'Posições do documento FI',   'FI'),
    ('transacao', 'ME21N', 'Criar pedido de compra',     'MM'),
    ('tabela',    'EKKO',  'Cabeçalho do pedido',        'MM'),
    ('tabela',    'EKPO',  'Posições do pedido',         'MM')
ON CONFLICT (codigo) DO NOTHING;

-- ============================================================
-- ARQUIVOS DE SESSÃO (contexto TXT e ZIP enviado pelo usuário)
-- ============================================================
CREATE TABLE IF NOT EXISTS session_files (
    id          SERIAL PRIMARY KEY,
    session_id  TEXT NOT NULL,
    filename    TEXT NOT NULL,
    content     TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    source_zip  VARCHAR(255),           -- Nome do arquivo ZIP original (NULL para arquivos TXT individuais)
    zip_path    TEXT,                   -- Caminho original dentro do ZIP (ex: src/components/example.tsx)
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_files_session    ON session_files(session_id);
CREATE INDEX IF NOT EXISTS idx_session_files_source_zip ON session_files(session_id, source_zip) WHERE source_zip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_session_files_zip_path   ON session_files(session_id, zip_path)   WHERE zip_path  IS NOT NULL;

COMMENT ON TABLE  session_files           IS 'Arquivos de contexto de sessão: TXT individuais ou extraídos de ZIP';
COMMENT ON COLUMN session_files.source_zip IS 'Nome do arquivo ZIP original quando o arquivo foi extraído de um ZIP';
COMMENT ON COLUMN session_files.zip_path   IS 'Caminho original do arquivo dentro do ZIP (ex: src/components/example.tsx)';

-- ============================================================
-- SKILLS (comportamentos especializados do agente)
-- ============================================================
CREATE TABLE IF NOT EXISTS skills (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,   -- slug, ex: 'cds-clean-core-refactoring'
    title       TEXT NOT NULL,          -- título legível
    description TEXT NOT NULL,          -- resumo curto (carregado sempre no contexto)
    content     TEXT NOT NULL,          -- prompt completo (lazy-loaded via use_skill)
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skills_active ON skills(is_active);

COMMENT ON TABLE  skills             IS 'Skills especializadas do agente: análises, templates e fluxos de trabalho';
COMMENT ON COLUMN skills.name        IS 'Identificador único usado nos slash commands (ex: /cds-analysis)';
COMMENT ON COLUMN skills.description IS 'Descrição breve mostrada no frontend (máximo 200 caracteres)';

-- ============================================================
-- MÉTRICAS DE USO DE TOKENS
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

-- ============================================================
-- LOG DE ERROS
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_errors (
    id            SERIAL PRIMARY KEY,
    session_id    TEXT,
    timestamp     TIMESTAMPTZ DEFAULT NOW(),
    error_message TEXT,
    error_type    TEXT,
    tool_name     TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_errors_ts ON chat_errors(timestamp);

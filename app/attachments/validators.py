"""
Validação de arquivos enviados como attachment de sessão.

Responsabilidades:
- Detecção de MIME via magic bytes (não confia em extensão ou Content-Type)
- Cross-check extensão declarada vs MIME real
- Sanitização de texto para prevenir prompt injection
- Sanitização de filename
"""

from __future__ import annotations

import re


import filetype

# MIMEs permitidos por categoria
ALLOWED_IMAGE_MIMES: frozenset[str] = frozenset({"image/jpeg", "image/png", "image/webp"})
ALLOWED_PDF_MIMES: frozenset[str] = frozenset({"application/pdf"})

# Mapeamento extensão → MIMEs aceitos
_EXT_TO_MIMES: dict[str, frozenset[str]] = {
    ".pdf":  ALLOWED_PDF_MIMES,
    ".jpg":  frozenset({"image/jpeg"}),
    ".jpeg": frozenset({"image/jpeg"}),
    ".png":  frozenset({"image/png"}),
    ".webp": frozenset({"image/webp"}),
}

# Regex para colapsar sequências longas de chars especiais (prompt injection guard)
# Preserva pontuação normal; colapsa 10+ repetições do mesmo char especial
_SPECIAL_REPEAT_RE = re.compile(r"([^\w\s])\1{9,}")

# Regex para sanitizar filename (idêntico ao padrão do router)
_UNSAFE_FILENAME_RE = re.compile(r"[^\w\s\-\.]")


def detect_mime_type(data: bytes) -> str:
    """
    Detecta o MIME type real de `data` via magic bytes usando a biblioteca `filetype`.

    Raises:
        ValueError: se o tipo não puder ser detectado.
    """
    kind = filetype.guess(data)
    if kind is None:
        raise ValueError(
            "Não foi possível identificar o tipo do arquivo. "
            "Envie um PDF ou imagem JPEG/PNG/WebP válida."
        )
    return kind.mime


def validate_upload_mime(data: bytes, declared_ext: str) -> str:
    """
    Verifica o MIME real do arquivo e valida contra a extensão declarada.

    Args:
        data: bytes brutos do arquivo.
        declared_ext: extensão com ponto, ex: ".pdf", ".jpg".

    Returns:
        MIME type confirmado (ex: "application/pdf").

    Raises:
        ValueError: se o tipo for não suportado ou diferente do declarado.
    """
    ext = declared_ext.lower()
    allowed_mimes = _EXT_TO_MIMES.get(ext)
    if allowed_mimes is None:
        raise ValueError(f"Extensão '{ext}' não é suportada como attachment de mídia.")

    actual_mime = detect_mime_type(data)

    if actual_mime not in allowed_mimes:
        raise ValueError(
            f"O conteúdo do arquivo não corresponde à extensão '{ext}'. "
            f"Tipo detectado: '{actual_mime}'. Envie um arquivo válido."
        )

    return actual_mime


def sanitize_content_for_llm(text: str) -> str:
    """
    Colapsa sequências de 10+ caracteres especiais idênticos para um único caractere.
    Previne tentativas de prompt injection via padrões repetitivos em conteúdo extraído.
    """
    return _SPECIAL_REPEAT_RE.sub(r"\1", text)


def sanitize_filename(filename: str) -> str:
    """
    Remove caracteres inseguros do nome de arquivo.
    Mesmo padrão usado no router de attachments existente.
    """
    return _UNSAFE_FILENAME_RE.sub("_", filename)

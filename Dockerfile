# syntax=docker/dockerfile:1
FROM python:3.13-slim

WORKDIR /app

# Copy uv binary from official image (10-100x faster than pip)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# System dependencies — cached by BuildKit between rebuilds
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
        build-essential curl

# Copy only dependency manifest so this layer is cached until pyproject.toml changes
COPY pyproject.toml pdm.lock* ./

# Step 1: Install CPU-only torch BEFORE the rest to prevent sentence-transformers
# from pulling the CUDA wheel (~2 GB). CPU wheel is ~300 MB.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system \
        --index-url https://download.pytorch.org/whl/cpu \
        torch

# Step 2: Install all remaining project dependencies.
# torch is already present, so uv will not reinstall the CUDA variant.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system .

# Pre-download embedding model — baked into the image layer.
# Eliminates the ~30 s–5 min download on first container startup.
ENV SENTENCE_TRANSFORMERS_HOME=/app/.cache/sentence_transformers
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-MiniLM-L6-v2')"

# Copy application code AFTER deps so code changes don't invalidate the dep layers
COPY app/ ./app/
COPY scripts/ ./scripts/

RUN useradd --create-home app && chown -R app:app /app
USER app

EXPOSE 8000

ENV PYTHONPATH=/app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

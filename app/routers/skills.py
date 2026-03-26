import re
import time
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db

router = APIRouter()

MAX_SKILL_BYTES = 200 * 1024  # 200 KB


class SkillResponse(BaseModel):
    id: int
    name: str
    title: str
    description: str
    is_active: bool
    created_at: datetime


def _parse_skill_file(raw: str) -> tuple[str, str, str, str]:
    """Parse skill file with optional YAML frontmatter.

    Returns (name, title, description, content).
    """
    fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)", raw, re.DOTALL)

    if fm_match:
        frontmatter = fm_match.group(1)
        content = fm_match.group(2).strip()

        name_m = re.search(r"^name:\s*(.+)$", frontmatter, re.MULTILINE)
        name = name_m.group(1).strip() if name_m else f"skill-{int(time.time())}"

        # Handle YAML folded scalar (description: >\n  lines...) and inline
        desc_folded = re.search(
            r"^description:\s*>[-]?\s*\n((?:[ \t]+[^\n]+\n?)+)",
            frontmatter,
            re.MULTILINE,
        )
        if desc_folded:
            lines = desc_folded.group(1).splitlines()
            description = " ".join(line.strip() for line in lines if line.strip())
        else:
            desc_inline = re.search(r"^description:\s*(.+)$", frontmatter, re.MULTILINE)
            description = desc_inline.group(1).strip() if desc_inline else ""
    else:
        content = raw.strip()
        name = f"skill-{int(time.time())}"
        description = content[:200]

    # Title: first # heading in content body, else name
    title_m = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    title = title_m.group(1).strip() if title_m else name

    return name, title, description, content


@router.get("/", response_model=list[SkillResponse])
async def list_skills(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text(
            "SELECT id, name, title, description, is_active, created_at "
            "FROM skills ORDER BY created_at DESC"
        )
    )
    return [
        SkillResponse(
            id=row.id,
            name=row.name,
            title=row.title,
            description=row.description,
            is_active=row.is_active,
            created_at=row.created_at,
        )
        for row in result.fetchall()
    ]


@router.post("/", response_model=SkillResponse, status_code=201)
async def upload_skill(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    filename = file.filename or "skill.md"
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext not in ("md", "txt"):
        raise HTTPException(status_code=400, detail="Apenas arquivos .md ou .txt são aceitos.")

    raw_bytes = await file.read(MAX_SKILL_BYTES + 1)
    if len(raw_bytes) > MAX_SKILL_BYTES:
        raise HTTPException(status_code=413, detail="Arquivo excede o limite de 200 KB.")

    try:
        raw = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raw = raw_bytes.decode("latin-1")

    name, title, description, content = _parse_skill_file(raw)

    # Sanitize slug: only alphanumeric, hyphens, underscores
    name = re.sub(r"[^a-zA-Z0-9\-_]", "-", name).strip("-")
    if not name:
        name = f"skill-{int(time.time())}"

    result = await db.execute(
        text("""
            INSERT INTO skills(name, title, description, content)
            VALUES(:name, :title, :desc, :content)
            ON CONFLICT (name) DO UPDATE
            SET title       = EXCLUDED.title,
                description = EXCLUDED.description,
                content     = EXCLUDED.content,
                updated_at  = NOW()
            RETURNING id, name, title, description, is_active, created_at
        """),
        {"name": name, "title": title, "desc": description, "content": content},
    )
    row = result.fetchone()
    await db.commit()

    return SkillResponse(
        id=row.id,
        name=row.name,
        title=row.title,
        description=row.description,
        is_active=row.is_active,
        created_at=row.created_at,
    )


@router.delete("/{skill_id}", status_code=204)
async def delete_skill(skill_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(text("DELETE FROM skills WHERE id = :id"), {"id": skill_id})
    await db.commit()


@router.patch("/{skill_id}/toggle", response_model=SkillResponse)
async def toggle_skill(skill_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("""
            UPDATE skills
            SET is_active  = NOT is_active,
                updated_at = NOW()
            WHERE id = :id
            RETURNING id, name, title, description, is_active, created_at
        """),
        {"id": skill_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Skill não encontrada.")
    await db.commit()
    return SkillResponse(
        id=row.id,
        name=row.name,
        title=row.title,
        description=row.description,
        is_active=row.is_active,
        created_at=row.created_at,
    )

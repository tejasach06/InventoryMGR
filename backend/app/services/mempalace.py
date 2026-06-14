from pathlib import Path

from fastapi import HTTPException, status

from app.schemas.mempalace import MempalaceSearchHit

MAX_SNIPPET_CHARS = 240


def _wiki_root(vault_path: str) -> Path:
    vault = Path(vault_path).expanduser().resolve()
    wiki = vault / "wiki"
    if not wiki.is_dir():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mempalace vault is unavailable",
        )
    return wiki


def _frontmatter_value(lines: list[str], key: str) -> str | None:
    if not lines or lines[0].strip() != "---":
        return None
    prefix = f"{key}:"
    for line in lines[1:]:
        stripped = line.strip()
        if stripped == "---":
            return None
        if stripped.startswith(prefix):
            value = stripped[len(prefix) :].strip()
            return value or None
    return None


def _title_for(path: Path, lines: list[str]) -> str:
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return path.stem.replace("-", " ").title()


def _snippet(line: str) -> str:
    normalized = " ".join(line.strip().split())
    if len(normalized) <= MAX_SNIPPET_CHARS:
        return normalized
    return f"{normalized[: MAX_SNIPPET_CHARS - 1].rstrip()}…"


def _best_line(lines: list[str], terms: list[str], phrase: str) -> tuple[int, str, int]:
    best_line_number = 1
    best_text = lines[0] if lines else ""
    best_score = -1
    for line_number, line in enumerate(lines, start=1):
        folded = line.casefold()
        phrase_hits = folded.count(phrase)
        term_hits = sum(folded.count(term) for term in terms)
        score = phrase_hits * 10 + term_hits
        if score > best_score:
            best_line_number = line_number
            best_text = line
            best_score = score
    return best_line_number, best_text, max(best_score, 0)


def _page_score(title: str, relative_path: str, text: str, terms: list[str], phrase: str) -> int:
    folded_title = title.casefold()
    folded_path = relative_path.casefold()
    folded_text = text.casefold()
    return (
        folded_title.count(phrase) * 40
        + folded_path.count(phrase) * 20
        + folded_text.count(phrase) * 10
        + sum(folded_title.count(term) * 8 for term in terms)
        + sum(folded_path.count(term) * 4 for term in terms)
        + sum(folded_text.count(term) for term in terms)
    )


def search_wiki(vault_path: str, query: str, limit: int) -> list[MempalaceSearchHit]:
    wiki = _wiki_root(vault_path)
    normalized_query = " ".join(query.split())
    terms = [term.casefold() for term in normalized_query.split()]
    phrase = normalized_query.casefold()
    if not terms:
        return []

    scored_hits: list[tuple[int, MempalaceSearchHit]] = []
    for path in sorted(wiki.rglob("*.md")):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        folded_text = text.casefold()
        if not all(term in folded_text for term in terms):
            continue
        lines = text.splitlines()
        relative_path = path.relative_to(wiki.parent).as_posix()
        title = _title_for(path, lines)
        line_number, line_text, line_score = _best_line(lines, terms, phrase)
        page_score = _page_score(title, relative_path, text, terms, phrase) + line_score
        scored_hits.append(
            (
                page_score,
                MempalaceSearchHit(
                    title=title,
                    path=relative_path,
                    page_type=_frontmatter_value(lines, "type"),
                    line=line_number,
                    snippet=_snippet(line_text),
                ),
            )
        )

    scored_hits.sort(key=lambda item: (-item[0], item[1].path))
    return [hit for _, hit in scored_hits[:limit]]

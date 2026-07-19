"""
Shared markdown parsing for chat export (.docx / .pdf).

Produces a small, render-agnostic block/inline model so both export
backends stay in sync. This is not a full CommonMark implementation --
just the constructs the app's own chat renderer (marked.js, GFM) commonly
produces: headings, paragraphs, bold/italic/code, bullet/numbered lists,
fenced code blocks, tables, and horizontal rules.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class Block:
    kind: str  # "heading" | "paragraph" | "bullet" | "number" | "code" | "table" | "hr"
    level: int = 0
    text: str = ""
    lines: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)


@dataclass
class InlineRun:
    text: str
    bold: bool = False
    italic: bool = False
    code: bool = False


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET_RE = re.compile(r"^\s*[-*+]\s+(.*)$")
_NUMBER_RE = re.compile(r"^\s*\d+[.)]\s+(.*)$")
_HR_RE = re.compile(r"^\s*([-*_])\1{2,}\s*$")
_FENCE_RE = re.compile(r"^\s*```")
_TABLE_SEP_RE = re.compile(r"^\s*\|?(\s*:?-+:?\s*\|)*\s*:?-+:?\s*\|?\s*$")


def _split_table_row(line: str) -> list[str]:
    row = line.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|") and not row.endswith("\\|"):
        row = row[:-1]
    return [cell.strip() for cell in row.split("|")]


def parse_blocks(text: str) -> list[Block]:
    """Line-based scan of markdown-ish text into a flat block list."""
    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[Block] = []
    paragraph_lines: list[str] = []
    n = len(lines)
    i = 0

    def flush_paragraph() -> None:
        if paragraph_lines:
            blocks.append(Block(kind="paragraph", text="\n".join(paragraph_lines)))
            paragraph_lines.clear()

    while i < n:
        line = lines[i]

        if _FENCE_RE.match(line):
            flush_paragraph()
            code_lines: list[str] = []
            i += 1
            while i < n and not _FENCE_RE.match(lines[i]):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing fence (or EOF if unterminated)
            blocks.append(Block(kind="code", lines=code_lines))
            continue

        if not line.strip():
            flush_paragraph()
            i += 1
            continue

        if _HR_RE.match(line):
            flush_paragraph()
            blocks.append(Block(kind="hr"))
            i += 1
            continue

        heading_match = _HEADING_RE.match(line)
        if heading_match:
            flush_paragraph()
            blocks.append(
                Block(kind="heading", level=len(heading_match.group(1)), text=heading_match.group(2).strip())
            )
            i += 1
            continue

        if "|" in line and i + 1 < n and _TABLE_SEP_RE.match(lines[i + 1]) and "-" in lines[i + 1]:
            flush_paragraph()
            rows = [_split_table_row(line)]
            i += 2  # header + separator row
            while i < n and lines[i].strip() and "|" in lines[i] and not _HR_RE.match(lines[i]):
                rows.append(_split_table_row(lines[i]))
                i += 1
            blocks.append(Block(kind="table", rows=rows))
            continue

        bullet_match = _BULLET_RE.match(line)
        if bullet_match:
            flush_paragraph()
            blocks.append(Block(kind="bullet", text=bullet_match.group(1).strip()))
            i += 1
            continue

        number_match = _NUMBER_RE.match(line)
        if number_match:
            flush_paragraph()
            blocks.append(Block(kind="number", text=number_match.group(1).strip()))
            i += 1
            continue

        paragraph_lines.append(line)
        i += 1

    flush_paragraph()
    return blocks


_INLINE_RE = re.compile(
    r"\*\*(?P<bold1>.+?)\*\*"
    r"|__(?P<bold2>.+?)__"
    r"|`(?P<code>.+?)`"
    r"|\*(?P<italic1>[^\s*](?:.*?[^\s*])?)\*"
    r"|_(?P<italic2>[^\s_](?:.*?[^\s_])?)_"
)


def soft_break_long_tokens(text: str, max_run: int = 40) -> str:
    """
    Insert an invisible zero-width space every `max_run` characters inside
    any whitespace-free run longer than that, so long URLs/code tokens can
    wrap in a renderer instead of overflowing the page edge. Never removes
    or changes visible characters -- only adds invisible break points.
    """
    if not text:
        return text

    def _break(token: str) -> str:
        if len(token) <= max_run:
            return token
        return "\u200b".join(token[j : j + max_run] for j in range(0, len(token), max_run))

    parts = re.split(r"(\s+)", text)
    return "".join(part if (not part or part.isspace()) else _break(part) for part in parts)


def parse_inline(text: str) -> list[InlineRun]:
    """Tokenize **bold**/__bold__, `code`, *italic*/_italic_ into runs."""
    text = text or ""
    runs: list[InlineRun] = []
    pos = 0
    for match in _INLINE_RE.finditer(text):
        if match.start() > pos:
            literal = text[pos : match.start()]
            if literal:
                runs.append(InlineRun(text=soft_break_long_tokens(literal)))
        if match.group("bold1") is not None:
            runs.append(InlineRun(text=soft_break_long_tokens(match.group("bold1")), bold=True))
        elif match.group("bold2") is not None:
            runs.append(InlineRun(text=soft_break_long_tokens(match.group("bold2")), bold=True))
        elif match.group("code") is not None:
            runs.append(InlineRun(text=soft_break_long_tokens(match.group("code"), max_run=30), code=True))
        elif match.group("italic1") is not None:
            runs.append(InlineRun(text=soft_break_long_tokens(match.group("italic1")), italic=True))
        elif match.group("italic2") is not None:
            runs.append(InlineRun(text=soft_break_long_tokens(match.group("italic2")), italic=True))
        pos = match.end()
    if pos < len(text):
        tail = text[pos:]
        if tail:
            runs.append(InlineRun(text=soft_break_long_tokens(tail)))
    if not runs and text:
        runs.append(InlineRun(text=soft_break_long_tokens(text)))
    return runs

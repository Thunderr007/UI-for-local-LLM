"""SerpAPI web search helper — rich results, page fetch, query routing."""

from __future__ import annotations

import asyncio
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import trafilatura
from dotenv import load_dotenv

SERPAPI_URL = "https://serpapi.com/search.json"
DEFAULT_NUM_RESULTS = 5
FETCH_TOP_N = 3
FETCH_TIMEOUT = 12.0
PAGE_CHAR_LIMIT = 2_500
TOTAL_FETCH_BUDGET = 8_000

_APP_DIR = Path(__file__).resolve().parent.parent  # project root (for .env)

# Browser-like UA avoids 403s on Wikipedia, Cloudflare-protected sites, etc.
_FETCH_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0 Safari/537.36"
)

_NEWS_RE = re.compile(
    r"\b(latest|today|breaking|news|recent|just|now|this week|what happened|"
    r"current|update|announce|release)\b",
    re.IGNORECASE,
)

WEB_SEARCH_SYSTEM_PREFIX = """You are a helpful assistant with access to recent web search results.
Use the search results below to answer the user's question.
Cite sources using [1], [2], … notation matching the numbered source list provided.
Include clickable source links where relevant.
If the search results do not contain enough information, say so clearly.
Never include patient-identifiable information (PHI) in your responses.
For medical or clinical topics, summarize what the sources say — do not provide clinical advice."""


@dataclass
class WebSearchResult:
    prompt_text: str
    sources: list[dict[str, Any]] = field(default_factory=list)
    search_type: str = "general"


def load_serpapi_config() -> None:
    """Load SerpAPI key from .env and/or serpapikey.env."""
    load_dotenv(_APP_DIR / ".env")
    load_dotenv(_APP_DIR / "serpapikey.env")

    if os.environ.get("SERPAPI_KEY", "").strip():
        return

    key_file = _APP_DIR / "serpapikey.env"
    if not key_file.is_file():
        return

    raw = key_file.read_text(encoding="utf-8").strip()
    if not raw or raw.startswith("#"):
        return

    if "=" in raw and not raw.startswith("http"):
        name, _, value = raw.partition("=")
        if name.strip().upper() == "SERPAPI_KEY":
            os.environ["SERPAPI_KEY"] = value.strip().strip('"').strip("'")
        return

    os.environ["SERPAPI_KEY"] = raw


load_serpapi_config()


def is_configured() -> bool:
    return bool(os.environ.get("SERPAPI_KEY", "").strip())


def _require_api_key() -> str:
    key = os.environ.get("SERPAPI_KEY", "").strip()
    if not key:
        raise ValueError(
            "SERPAPI_KEY is not set. Add it to a .env file in the UI for local LLM folder."
        )
    return key


def classify_query(query: str) -> str:
    """Return 'news' for time-sensitive queries, 'general' otherwise."""
    return "news" if _NEWS_RE.search(query) else "general"


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.removeprefix("www.")
    except Exception:
        return url


def _build_sources(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduplicate URLs and return numbered source list."""
    seen: set[str] = set()
    sources: list[dict[str, Any]] = []
    for item in items:
        url = (item.get("link") or item.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        sources.append(
            {
                "index": len(sources) + 1,
                "title": item.get("title") or _domain(url),
                "url": url,
                "domain": _domain(url),
            }
        )
    return sources


async def _fetch_page_text(url: str, client: httpx.AsyncClient) -> str:
    """Fetch a URL and extract readable text with trafilatura."""
    try:
        r = await client.get(
            url,
            headers={"User-Agent": _FETCH_UA},
            timeout=FETCH_TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        text = trafilatura.extract(
            r.text,
            include_comments=False,
            include_tables=True,
            no_fallback=False,
        )
        return (text or "").strip()
    except Exception:
        return ""


def _format_rich_results(
    data: dict[str, Any],
    sources: list[dict[str, Any]],
    page_texts: list[str],
    search_type: str,
    num_results: int = DEFAULT_NUM_RESULTS,
) -> str:
    blocks: list[str] = []

    # Answer box — direct factual answer
    ab = data.get("answer_box") or {}
    if ab:
        ab_parts: list[str] = []
        for key in ("answer", "snippet", "result"):
            val = ab.get(key)
            if val and isinstance(val, str) and val.strip():
                ab_parts.append(val.strip())
                break
        ab_title = ab.get("title", "")
        ab_link = ab.get("link", "")
        if ab_parts:
            line = f"Direct answer: {ab_parts[0]}"
            if ab_title:
                line = f"**{ab_title}** — {ab_parts[0]}"
            if ab_link:
                line += f"\n  Source: {ab_link}"
            blocks.append(line)

    # Knowledge graph — entity info
    kg = data.get("knowledge_graph") or {}
    if kg:
        kg_parts: list[str] = []
        name = kg.get("title", "")
        desc = kg.get("description", "")
        ktype = kg.get("type", "")
        kg_link = kg.get("website") or kg.get("source", {}).get("link", "")
        if name and desc:
            label = f"**{name}**"
            if ktype:
                label += f" ({ktype})"
            kg_parts.append(f"{label}: {desc}")
            if kg_link:
                kg_parts.append(f"  Source: {kg_link}")
        if kg_parts:
            blocks.append("\n".join(kg_parts))

    # Organic or news results with page content
    result_items = (
        data.get("news_results", [])[:num_results]
        if search_type == "news"
        else data.get("organic_results", [])[:num_results]
    )

    used_budget = 0
    for src in sources:
        # Find matching result item for snippet
        snippet = ""
        for item in result_items:
            item_url = (item.get("link") or item.get("url") or "").strip()
            if item_url == src["url"]:
                snippet = item.get("snippet") or item.get("summary") or ""
                break

        # Page text for this source (if we fetched it)
        src_idx = src["index"] - 1  # 0-based index into page_texts
        page_text = page_texts[src_idx] if src_idx < len(page_texts) else ""
        if page_text and used_budget < TOTAL_FETCH_BUDGET:
            remaining = TOTAL_FETCH_BUDGET - used_budget
            page_text = page_text[: min(PAGE_CHAR_LIMIT, remaining)]
            used_budget += len(page_text)
        else:
            page_text = ""

        lines = [f"[{src['index']}] **{src['title']}** — {src['domain']}"]
        if snippet:
            lines.append(f"  {snippet}")
        if page_text:
            lines.append(f"\n  Full content:\n  {page_text.replace(chr(10), chr(10) + '  ')}")
        lines.append(f"  URL: {src['url']}")
        blocks.append("\n".join(lines))

    # Related questions — extra context
    for rq in (data.get("related_questions") or [])[:2]:
        q = rq.get("question", "")
        ans = rq.get("snippet") or rq.get("answer") or ""
        if q and ans:
            blocks.append(f"Related: **{q}**\n  {ans}")

    if not blocks:
        return "No web results found for this query."

    label = "News search results" if search_type == "news" else "Web search results"
    return f"{label}:\n\n" + "\n\n".join(blocks)


def build_system_prompt(search_result: WebSearchResult) -> str:
    sources_section = ""
    if search_result.sources:
        lines = [f"[{s['index']}] {s['title']} — {s['url']}" for s in search_result.sources]
        sources_section = "\n\nSources:\n" + "\n".join(lines)
    return f"{WEB_SEARCH_SYSTEM_PREFIX}\n\n{search_result.prompt_text}{sources_section}"


async def web_search(
    query: str, num_results: int = DEFAULT_NUM_RESULTS
) -> WebSearchResult:
    api_key = _require_api_key()
    search_type = classify_query(query)

    engine = "google_news" if search_type == "news" else "google"
    params: dict[str, Any] = {
        "engine": engine,
        "q": query,
        "api_key": api_key,
        "num": num_results,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(SERPAPI_URL, params=params)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"SerpAPI error: {e.response.text}") from e
        except httpx.RequestError as e:
            raise RuntimeError(f"SerpAPI connection failed: {e}") from e

    if data.get("error"):
        raise RuntimeError(str(data["error"]))

    # Collect candidate items for sources
    result_items = (
        data.get("news_results", [])[:num_results]
        if search_type == "news"
        else data.get("organic_results", [])[:num_results]
    )

    # Supplement sources from answer_box / knowledge_graph links
    candidate_items = list(result_items)
    ab_link = (data.get("answer_box") or {}).get("link")
    kg_link = (data.get("knowledge_graph") or {}).get(
        "website"
    ) or (data.get("knowledge_graph") or {}).get("source", {}).get("link")
    if ab_link:
        candidate_items.insert(0, {"link": ab_link, "title": (data.get("answer_box") or {}).get("title", "")})
    if kg_link:
        candidate_items.insert(0, {"link": kg_link, "title": (data.get("knowledge_graph") or {}).get("title", "")})

    sources = _build_sources(candidate_items)
    fetch_sources = sources[:FETCH_TOP_N]

    # Fetch page content for top sources concurrently
    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT) as fetch_client:
        tasks = [_fetch_page_text(s["url"], fetch_client) for s in fetch_sources]
        raw_pages = await asyncio.gather(*tasks, return_exceptions=True)

    page_texts = [
        t if isinstance(t, str) else ""
        for t in raw_pages
    ]
    # Pad to match sources length
    while len(page_texts) < len(sources):
        page_texts.append("")

    prompt_text = _format_rich_results(data, sources, page_texts, search_type, num_results)

    return WebSearchResult(
        prompt_text=prompt_text,
        sources=sources,
        search_type=search_type,
    )

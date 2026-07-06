"""SerpAPI web search helper."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

SERPAPI_URL = "https://serpapi.com/search.json"
DEFAULT_NUM_RESULTS = 5
_APP_DIR = Path(__file__).resolve().parent

WEB_SEARCH_SYSTEM_PREFIX = """You are a helpful assistant with access to recent web search results.
Use the search results below to answer the user's question. Cite sources with links when possible.
If the search results do not contain enough information, say so clearly.
Never include patient-identifiable information (PHI) in your responses.
For medical or clinical topics, summarize what the sources say — do not provide clinical advice."""


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
        # KEY=value line without dotenv parsing (e.g. SERPAPI_KEY=...)
        name, _, value = raw.partition("=")
        if name.strip().upper() == "SERPAPI_KEY":
            os.environ["SERPAPI_KEY"] = value.strip().strip('"').strip("'")
        return

    # Raw API key only (no variable name).
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


def format_results(data: dict[str, Any], num_results: int = DEFAULT_NUM_RESULTS) -> str:
    blocks: list[str] = []
    for item in data.get("organic_results", [])[:num_results]:
        title = item.get("title") or "Untitled"
        snippet = item.get("snippet") or ""
        link = item.get("link") or ""
        blocks.append(f"- **{title}**\n  {snippet}\n  Source: {link}")

    if not blocks:
        return "No web results found for this query."

    return "Web search results:\n\n" + "\n\n".join(blocks)


def build_system_prompt(search_results: str) -> str:
    return f"{WEB_SEARCH_SYSTEM_PREFIX}\n\n{search_results}"


async def web_search(query: str, num_results: int = DEFAULT_NUM_RESULTS) -> str:
    api_key = _require_api_key()
    params = {
        "engine": "google",
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

    return format_results(data, num_results=num_results)

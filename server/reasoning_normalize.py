"""Normalize Ollama (and legacy) reasoning traces into a single thinking stream."""

from __future__ import annotations

import json
import re
from typing import Any

# Tags that wrap reasoning inside message.content for some models.
_TAG_SPECS: tuple[tuple[str, str], ...] = (
    ("<think>", "</think>"),
    ("<thinking>", "</thinking>"),
    ("<reasoning>", "</reasoning>"),
)

_THINK_ERROR_RE = re.compile(
    r"("
    r"does not support think|"
    r"doesn't support think|"
    r"think(ing)? (is )?(not |un)supported|"
    r"unknown field [\"']?think|"
    r"invalid (argument|option|field).{0,40}think|"
    r"unsupported (option|parameter).{0,20}think"
    r")",
    re.IGNORECASE,
)


def looks_like_think_unsupported(error_text: str) -> bool:
    """True when Ollama rejected the think option for this model."""
    return bool(_THINK_ERROR_RE.search(error_text or ""))


def extract_structured_thinking(chunk: dict[str, Any]) -> str:
    """Pull reasoning from structured fields on an Ollama chat/generate chunk."""
    parts: list[str] = []
    msg = chunk.get("message")
    if isinstance(msg, dict):
        for key in ("thinking", "reasoning", "reasoning_content"):
            val = msg.get(key)
            if isinstance(val, str) and val:
                parts.append(val)
    for key in ("thinking", "reasoning", "reasoning_content"):
        val = chunk.get(key)
        if isinstance(val, str) and val:
            parts.append(val)
    return "".join(parts)


class ReasoningStreamNormalizer:
    """
    Stateful normalizer for streamed (or one-shot) chat chunks.

    Emits dicts with optional message.thinking / message.content so the UI can
    treat every model the same way.
    """

    def __init__(self) -> None:
        self._in_tag: str | None = None  # closing tag currently open, or None
        self._tag_buf = ""

    def feed_chunk(self, chunk: dict[str, Any]) -> list[dict[str, Any]]:
        """Normalize one Ollama JSON object into zero or more UI-facing chunks."""
        if not isinstance(chunk, dict):
            return []
        if chunk.get("error"):
            return [chunk]

        # Preserve non-message agent/event frames unchanged.
        if chunk.get("type") and "message" not in chunk and not any(
            k in chunk for k in ("thinking", "reasoning", "reasoning_content", "response")
        ):
            return [chunk]

        out: list[dict[str, Any]] = []
        structured = extract_structured_thinking(chunk)
        if structured:
            out.append({"message": {"thinking": structured}})

        content = ""
        msg = chunk.get("message")
        if isinstance(msg, dict) and isinstance(msg.get("content"), str):
            content = msg["content"]
        elif isinstance(chunk.get("response"), str):
            # /api/generate shape
            content = chunk["response"]
        elif isinstance(chunk.get("content"), str) and not isinstance(msg, dict):
            content = chunk["content"]

        if content:
            thinking_bits, answer_bits = self._split_tagged(content)
            if thinking_bits:
                out.append({"message": {"thinking": thinking_bits}})
            if answer_bits:
                piece: dict[str, Any] = {"message": {"content": answer_bits}}
                # Carry tool_calls with the content-bearing frame when present.
                if isinstance(msg, dict) and msg.get("tool_calls"):
                    piece["message"]["tool_calls"] = msg["tool_calls"]
                    piece["message"]["role"] = msg.get("role") or "assistant"
                out.append(piece)
        elif isinstance(msg, dict) and msg.get("tool_calls"):
            out.append(
                {
                    "message": {
                        "role": msg.get("role") or "assistant",
                        "content": "",
                        "tool_calls": msg["tool_calls"],
                    }
                }
            )

        if chunk.get("done"):
            done_frame = {k: v for k, v in chunk.items() if k != "message"}
            # Flush any residual buffer that never closed a tag into content.
            residual = self.flush()
            if residual.get("thinking"):
                out.append({"message": {"thinking": residual["thinking"]}})
            if residual.get("content"):
                out.append({"message": {"content": residual["content"]}})
            done_msg: dict[str, Any] = {"role": "assistant", "content": ""}
            if isinstance(msg, dict):
                if msg.get("tool_calls"):
                    done_msg["tool_calls"] = msg["tool_calls"]
                if msg.get("role"):
                    done_msg["role"] = msg["role"]
            done_frame["message"] = done_msg
            done_frame["done"] = True
            out.append(done_frame)

        return out

    def feed_line(self, line: str) -> list[dict[str, Any]]:
        """Parse one NDJSON/SSE body line from Ollama and normalize it."""
        text = line.strip()
        if not text:
            return []
        try:
            chunk = json.loads(text)
        except json.JSONDecodeError:
            return []
        return self.feed_chunk(chunk)

    def normalize_complete(self, data: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
        """
        Normalize a non-streaming chat response.

        Returns (thinking, content, message_dict_for_history).
        """
        frames = self.feed_chunk({**data, "done": True})
        thinking_parts: list[str] = []
        content_parts: list[str] = []
        tool_calls = None
        role = "assistant"
        for frame in frames:
            msg = frame.get("message") or {}
            if isinstance(msg, dict):
                if msg.get("thinking"):
                    thinking_parts.append(msg["thinking"])
                if msg.get("content"):
                    content_parts.append(msg["content"])
                if msg.get("tool_calls"):
                    tool_calls = msg["tool_calls"]
                if msg.get("role"):
                    role = msg["role"]
        thinking = "".join(thinking_parts)
        content = "".join(content_parts)
        history_msg: dict[str, Any] = {"role": role, "content": content}
        if thinking:
            history_msg["thinking"] = thinking
        if tool_calls:
            history_msg["tool_calls"] = tool_calls
        return thinking, content, history_msg

    def flush(self) -> dict[str, str]:
        """Emit leftover tag buffer (treated as content if not inside a tag)."""
        leftover = self._tag_buf
        self._tag_buf = ""
        if not leftover:
            self._in_tag = None
            return {}
        if self._in_tag:
            self._in_tag = None
            return {"thinking": leftover}
        return {"content": leftover}

    def _split_tagged(self, text: str) -> tuple[str, str]:
        thinking: list[str] = []
        answer: list[str] = []
        i = 0
        buf = self._tag_buf
        self._tag_buf = ""
        data = buf + text

        while i < len(data):
            if self._in_tag:
                close = self._in_tag
                idx = data.find(close, i)
                if idx == -1:
                    # Keep a short suffix that might be a partial closing tag.
                    keep = max(0, len(close) - 1)
                    if keep and len(data) - i > keep:
                        thinking.append(data[i : len(data) - keep])
                        self._tag_buf = data[len(data) - keep :]
                    else:
                        self._tag_buf = data[i:]
                    break
                thinking.append(data[i:idx])
                i = idx + len(close)
                self._in_tag = None
                continue

            next_open: tuple[int, str, str] | None = None
            for open_t, close_t in _TAG_SPECS:
                idx = data.find(open_t, i)
                if idx != -1 and (next_open is None or idx < next_open[0]):
                    next_open = (idx, open_t, close_t)

            # Partial open-tag at end of chunk?
            partial = self._partial_open_suffix(data, i)
            if next_open is None and partial is not None:
                if partial > i:
                    answer.append(data[i:partial])
                self._tag_buf = data[partial:]
                break

            if next_open is None:
                answer.append(data[i:])
                break

            idx, open_t, close_t = next_open
            if idx > i:
                answer.append(data[i:idx])
            i = idx + len(open_t)
            self._in_tag = close_t

        return "".join(thinking), "".join(answer)

    @staticmethod
    def _partial_open_suffix(data: str, start: int) -> int | None:
        """Index where a possible incomplete open tag begins, else None."""
        tail = data[start:]
        if not tail:
            return None
        for open_t, _ in _TAG_SPECS:
            for n in range(1, len(open_t)):
                if tail.endswith(open_t[:n]):
                    return len(data) - n
        return None


def apply_think_to_payload(payload: dict[str, Any], think: str) -> dict[str, Any]:
    """Copy payload and set Ollama think according to form value."""
    out = dict(payload)
    key = (think or "auto").strip().lower()
    if key in ("true", "1", "yes", "auto"):
        out["think"] = True
    elif key in ("false", "0", "no"):
        out.pop("think", None)
    else:
        # Level strings such as "high" / "low" for GPT-OSS-style models.
        out["think"] = think
    return out

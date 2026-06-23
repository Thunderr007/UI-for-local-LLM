"""
Local LLM Chat UI — talks to Ollama on localhost:11434
Run: python app.py
"""

from __future__ import annotations

import base64
import io
import json
import re
from pathlib import Path
from typing import Any

import httpx
from docx import Document
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pypdf import PdfReader

from telemetry import sample as telemetry_sample

OLLAMA_BASE = "http://localhost:11434"
STATIC_DIR = Path(__file__).parent / "static"
MAX_DOC_CHARS = 80_000
IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"}
DOC_TYPES = {
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

app = FastAPI(title="Local LLM Chat")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/telemetry")
async def telemetry():
    return telemetry_sample()


@app.get("/api/health")
async def health():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            r.raise_for_status()
            return {"ollama": True, "models": r.json().get("models", [])}
    except Exception as e:
        return {"ollama": False, "error": str(e)}


VISION_NAME_RE = re.compile(
    r"vision|llava|bakllava|moondream|minicpm-v|pixtral|qwen",
    re.IGNORECASE,
)


def model_support(model: dict[str, Any]) -> dict[str, bool]:
    caps = set(model.get("capabilities") or [])
    name = model.get("name") or ""
    vision = "vision" in caps or bool(VISION_NAME_RE.search(name))
    return {
        "text": True,
        "images": vision,
        "pdf": True,
        "pdf_scanned": vision,
        "docx": True,
        "txt": True,
        "tools": "tools" in caps,
        "thinking": "thinking" in caps,
    }


def model_labels(support: dict[str, bool]) -> list[dict[str, str]]:
    """Human-readable capability chips for the UI."""
    return [
        {
            "id": "text",
            "label": "Text",
            "status": "yes",
            "hint": "Plain text messages",
        },
        {
            "id": "images",
            "label": "Images",
            "status": "yes" if support["images"] else "no",
            "hint": "Photo analysis (JPG, PNG, WebP…)"
            if support["images"]
            else "Not a vision model — switch model to use images",
        },
        {
            "id": "pdf",
            "label": "PDF",
            "status": "yes" if support["pdf_scanned"] else "partial",
            "hint": "Text & scanned PDFs"
            if support["pdf_scanned"]
            else "Text PDFs only (scanned pages need a vision model)",
        },
        {
            "id": "docx",
            "label": "DOCX",
            "status": "yes",
            "hint": "Word documents (text extracted)",
        },
        {
            "id": "txt",
            "label": "TXT",
            "status": "yes",
            "hint": "Plain text files",
        },
        {
            "id": "tools",
            "label": "Tools",
            "status": "yes" if support["tools"] else "no",
            "hint": "Tool / function calling"
            if support["tools"]
            else "No tool-calling support",
        },
        {
            "id": "thinking",
            "label": "Thinking",
            "status": "yes" if support["thinking"] else "no",
            "hint": "Extended reasoning mode"
            if support["thinking"]
            else "No thinking mode",
        },
    ]


def model_context_length(model: dict[str, Any]) -> int:
    details = model.get("details") or {}
    ctx = details.get("context_length")
    if isinstance(ctx, int) and ctx > 0:
        return ctx
    family = (details.get("family") or "").lower()
    if "llama" in family:
        return 4096
    if "gemma" in family:
        return 8192
    return 8192


@app.get("/api/models")
async def list_models():
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            r.raise_for_status()
            models = r.json().get("models", [])
            enriched = []
            for m in models:
                support = model_support(m)
                enriched.append(
                    {
                        "name": m["name"],
                        "context_length": model_context_length(m),
                        "capabilities": list(m.get("capabilities") or []),
                        "support": support,
                        "labels": model_labels(support),
                    }
                )
            enriched.sort(key=lambda m: m["name"].lower())
            return {"models": enriched}
    except httpx.ConnectError:
        raise HTTPException(
            503,
            "Cannot reach Ollama. Make sure Ollama is running (ollama serve).",
        )
    except Exception as e:
        raise HTTPException(500, str(e))


def extract_document_text(filename: str, content: bytes, mime: str) -> str:
    lower = filename.lower()

    if mime == "text/plain" or lower.endswith(".txt"):
        for enc in ("utf-8", "utf-16", "latin-1"):
            try:
                return content.decode(enc)
            except UnicodeDecodeError:
                continue
        return content.decode("utf-8", errors="replace")

    if mime == "application/pdf" or lower.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(content))
        parts = []
        for page in reader.pages:
            text = page.extract_text() or ""
            if text.strip():
                parts.append(text)
        return "\n\n".join(parts)

    if lower.endswith(".docx") or mime in DOC_TYPES:
        doc = Document(io.BytesIO(content))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())

    raise ValueError(f"Unsupported document type: {filename}")


def build_user_message(
    text: str,
    images_b64: list[str],
    doc_text: str | None,
    doc_name: str | None,
) -> dict[str, Any]:
    parts = []
    if doc_text and doc_name:
        trimmed = doc_text[:MAX_DOC_CHARS]
        if len(doc_text) > MAX_DOC_CHARS:
            trimmed += "\n\n[Document truncated due to length limit.]"
        parts.append(
            f"--- Attached document: {doc_name} ---\n{trimmed}\n--- End of document ---"
        )
    if text.strip():
        parts.append(text.strip())
    elif images_b64:
        parts.append("Please analyze the attached image(s).")
    elif doc_text:
        parts.append("Please summarize and answer questions about the attached document.")

    content = "\n\n".join(parts)
    msg: dict[str, Any] = {"role": "user", "content": content}
    if images_b64:
        msg["images"] = images_b64
    return msg


@app.post("/api/chat")
async def chat(
    model: str = Form(...),
    messages: str = Form(...),
    stream: bool = Form(True),
    num_ctx: int = Form(4096),
    images: list[UploadFile] = File(default=[]),
    document: UploadFile | None = File(default=None),
):
    try:
        history: list[dict[str, Any]] = json.loads(messages)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid messages JSON")

    images_b64: list[str] = []
    for img in images:
        if not img.filename:
            continue
        data = await img.read()
        if not data:
            continue
        mime = img.content_type or "application/octet-stream"
        if mime not in IMAGE_TYPES and not (img.filename or "").lower().endswith(
            (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp")
        ):
            raise HTTPException(400, f"Unsupported image: {img.filename}")
        images_b64.append(base64.b64encode(data).decode("ascii"))

    doc_text: str | None = None
    doc_name: str | None = None
    if document and document.filename:
        doc_bytes = await document.read()
        if doc_bytes:
            doc_name = document.filename
            try:
                doc_text = extract_document_text(
                    document.filename,
                    doc_bytes,
                    document.content_type or "",
                )
            except Exception as e:
                raise HTTPException(400, f"Could not read document: {e}")
            if not doc_text.strip():
                raise HTTPException(400, "Document appears empty or unreadable.")

    # Attach files only to the latest user turn
    if history and history[-1].get("role") == "user":
        last = history[-1]
        user_msg = build_user_message(
            last.get("content", ""),
            images_b64,
            doc_text,
            doc_name,
        )
        history[-1] = user_msg
    else:
        history.append(build_user_message("", images_b64, doc_text, doc_name))

    ctx = max(512, min(num_ctx, 1_048_576))
    payload = {
        "model": model,
        "messages": history,
        "stream": stream,
        "options": {"num_ctx": ctx},
    }

    if not stream:
        try:
            async with httpx.AsyncClient(timeout=600.0) as client:
                r = await client.post(f"{OLLAMA_BASE}/api/chat", json=payload)
                r.raise_for_status()
                return r.json()
        except httpx.ConnectError:
            raise HTTPException(503, "Cannot reach Ollama.")
        except httpx.HTTPStatusError as e:
            raise HTTPException(e.response.status_code, e.response.text)

    async def event_stream():
        try:
            async with httpx.AsyncClient(timeout=600.0) as client:
                async with client.stream(
                    "POST", f"{OLLAMA_BASE}/api/chat", json=payload
                ) as response:
                    if response.status_code != 200:
                        body = await response.aread()
                        yield f"data: {json.dumps({'error': body.decode()})}\n\n"
                        return
                    async for line in response.aiter_lines():
                        if line:
                            yield f"data: {line}\n\n"
        except httpx.ConnectError:
            yield f"data: {json.dumps({'error': 'Cannot reach Ollama. Is it running?'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    import uvicorn

    print("\n  Local LLM Chat UI")
    print("  Open http://127.0.0.1:7860 in your browser\n")
    uvicorn.run(app, host="127.0.0.1", port=7860, log_level="info")

# Local LLM Chat UI

A ChatGPT-style web interface for your **locally installed Ollama models**. Supports text chat, image analysis (vision models), and document upload (PDF, TXT, DOCX).

## Prerequisites

1. **Ollama** — [Download](https://ollama.com/download)
2. **Python 3.10+** — [Download](https://www.python.org/downloads/) (check "Add Python to PATH")

## Quick start (Windows)

1. Make sure Ollama is running (it usually starts automatically after install).
2. Pull at least one model:
   ```bash
   ollama pull llama3.2
   ```
3. Double-click **`start.bat`** in this folder.
4. Open **http://127.0.0.1:7860** in your browser.

## Manual install

```bash
cd "UI for local LLM"
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Then open **http://127.0.0.1:7860**.

## Recommended models

| Use case | Example model | Pull command |
|----------|---------------|--------------|
| General text chat | llama3.2, mistral, qwen2.5 | `ollama pull llama3.2` |
| Images + text | llama3.2-vision, llava, gemma3 | `ollama pull llama3.2-vision` |
| Smaller / faster | phi3, gemma2:2b | `ollama pull phi3` |

List your installed models:

```bash
ollama list
```

## Features

- **Model picker** — loads models from Ollama automatically
- **Streaming replies** — responses appear word-by-word
- **Images** — attach images; use a **vision** model (e.g. `llama3.2-vision`)
- **Documents** — PDF, TXT, DOCX text is extracted and sent with your message
- **New chat** — clear history and start fresh
- **Dark theme** — similar layout to popular chat UIs

## How it works

```
Browser (UI)  →  Python app (port 7860)  →  Ollama API (port 11434)  →  Local LLM
```

The UI does not download or run models itself. Ollama handles that.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Cannot reach Ollama" | Run `ollama serve` or restart the Ollama app |
| No models in dropdown | Run `ollama pull llama3.2` (or any model) |
| Image questions fail | Switch to a vision model like `llama3.2-vision` |
| PDF empty / garbled | Scanned PDFs need OCR; try a vision model on page screenshots |
| Port 7860 in use | Change port in `app.py` (last line) |

## File structure

```
UI for local LLM/
├── app.py           # Backend (FastAPI + Ollama proxy)
├── static/          # Chat UI (HTML/CSS/JS)
├── requirements.txt
├── start.bat        # One-click launcher (Windows)
└── README.md
```

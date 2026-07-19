# Local LLM Chat UI

A ChatGPT-style web interface for your **locally installed Ollama models**. Supports text chat, image analysis (vision models), document upload (PDF, TXT, DOCX), optional live web search, hardware telemetry, and exporting chats to `.txt` / Word / PDF.

## Prerequisites

1. **Ollama** — [Download](https://ollama.com/download)
2. **Python 3.10+** — [Download](https://www.python.org/downloads/) (check "Add Python to PATH")
3. *(Optional)* A **SerpAPI** key if you want the **Web** search toggle — [serpapi.com](https://serpapi.com/)

## First-time setup checklist

Do these once on a new machine:

1. Install **Ollama** and leave it running.
2. Pull at least one model, e.g. `ollama pull llama3.2` (add a vision model if you want image chat).
3. Open this project folder: `UI for local LLM`.
4. Double-click **`start.bat`** (Windows). It creates a `venv`, installs dependencies from `requirements.txt`, starts the server, and opens **http://127.0.0.1:7860** in your browser.
5. *(Optional)* Enable web search — copy `.env.example` to `.env`, add your `SERPAPI_KEY`, restart the app. Details: [docs/SERPAPI_KEY_SETUP.md](docs/SERPAPI_KEY_SETUP.md).
6. Pick a model in the sidebar and send a message.

No need to manually open the localhost URL when using `start.bat` — the launcher waits for the server, then opens the page for you.

## Quick start (Windows)

1. Make sure Ollama is running.
2. Pull a model if you have none:
   ```bash
   ollama pull llama3.2
   ```
3. Double-click **`start.bat`**.
4. Chat in the browser tab that opens.

## Manual install

```bash
cd "UI for local LLM"
python -m venv venv
venv\Scripts\activate   # Mac/Linux: source venv/bin/activate
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
List installed models:

```bash
ollama list
```

## Features

- **Model picker** — loads models from Ollama automatically (vision / thinking labels when supported)
- **Streaming replies** — responses appear token-by-token
- **Images** — attach images; use a **vision** model (e.g. `llama3.2-vision`)
- **Documents** — PDF, TXT, DOCX text is extracted and sent with your message
- **Web search** — optional SerpAPI lookup with page-content fetch, news routing, and source chips in the reply (toggle **Web** in the composer)
- **Location & weather** — opt-in **Share location** in the sidebar (off by default). One browser geolocation fix is cached for 1 hour; Open-Meteo weather is injected into the prompt only when coords are available. Failures skip weather — chat still runs.
- **Chat history** — sessions saved in the browser (IndexedDB); rename / delete from the sidebar
- **Export chat** — floating button (bottom-right) downloads the **active** chat as `.txt`, Word (`.docx`), or PDF
- **Command palette** — `Ctrl`+`K` for quick actions
- **Hardware telemetry** — CPU / RAM / GPU usage in the sidebar
- **Shutdown** — power button stops the local server from the UI
- **Dark greyscale UI** — honeycomb chat background with purposeful accent colors

## How it works

```
Browser (UI)  →  Python app (port 7860)  →  Ollama API (port 11434)  →  Local LLM
                                  ↘  SerpAPI + page fetch (optional web search)
                                  ↘  Open-Meteo (optional weather, needs shared lat/lon)
                                  ↘  /api/export (Word / PDF downloads)
```

The UI does not download or run models itself. Ollama handles that. Chat history lives in the browser; exports send the active session to the server only when you choose Word or PDF.

## Exporting a chat

1. Open (or continue) the chat you want to save.
2. Click the **download** button at the bottom-right of the chat area.
3. Choose **.txt**, **Word (.docx)**, or **PDF**.

- `.txt` downloads in the browser only.
- `.docx` / `.pdf` use the `/api/export` endpoint (needs `python-docx` and `reportlab`, installed via `requirements.txt`).
- Exported files keep plain document formatting (not the app theme). Markdown in replies is preserved where possible.

The button is disabled when there is no active chat, no messages, or a reply is still generating.

## Web search (SerpAPI)

Optional. Without a key, chat still works; the **Web** toggle stays disabled.

When enabled, the server:

1. Classifies the query (news vs general).
2. Calls SerpAPI and fetches the top result pages for fuller context.
3. Injects numbered sources into the prompt and shows source chips on the assistant message.

**Setup:**

1. Get an API key from [serpapi.com](https://serpapi.com/).
2. Save it locally (do **not** commit the real key):

   - **`.env`** (recommended): copy `.env.example` → `.env` and set `SERPAPI_KEY=...`
   - or **`serpapikey.env`**: paste the raw key on one line in this folder

3. Restart the app (`start.bat` or `python app.py`).
4. Turn on **Web** next to the message box before sending.

Full steps: [docs/SERPAPI_KEY_SETUP.md](docs/SERPAPI_KEY_SETUP.md).

## Location & weather

Optional and **off by default**. Open **Location & Weather** in the sidebar and enable **Share location**.

1. The browser asks for one **high-accuracy** geolocation fix (15s timeout). GPS altitude is stored when available.
2. Coordinates are stored in `localStorage` for **1 hour** (toggle off keeps the cache but stops sending coords).
3. Each chat with sharing on includes `lat` / `lon` (and optional `elevation`). The server calls [Open-Meteo](https://open-meteo.com/) with `models=best_match` (no API key, 3s timeout), reverse-geocodes a place name, and appends air temp, feels-like, humidity, and related fields only on success.
4. Any geo denial or weather error skips the weather line — chat continues normally.

Time-sensitive questions may also get a local clock line from the server (no location required).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Cannot reach Ollama" | Run `ollama serve` or restart the Ollama app |
| No models in dropdown | Run `ollama pull llama3.2` (or any model) |
| Image questions fail | Switch to a vision model like `llama3.2-vision` |
| PDF empty / garbled | Scanned PDFs need OCR; try a vision model on page screenshots |
| Port 7860 in use | `start.bat` tries to free the port; or change the port at the bottom of `app.py` |
| Browser did not open | Open **http://127.0.0.1:7860** manually; check the minimized server window for errors |
| Web toggle disabled | Add your key to `.env` or `serpapikey.env` and restart the server |
| Web search failed | Check SerpAPI quota/key; see server logs |
| Location denied / weather missing | Allow location for the site, re-enable Share location; weather is skipped on Open-Meteo failures |
| Export Word/PDF fails | Re-run `pip install -r requirements.txt` (needs `reportlab` + `python-docx`) and restart |
| Export button greyed out | Select a chat with messages and wait until generation finishes |
| History missing after wipe | Chats are stored in this browser’s IndexedDB — clearing site data removes them |

## File structure

```
UI for local LLM/
├── app.py                 # Launcher (start.bat runs this)
├── start.bat              # One-click launcher (venv + browser)
├── requirements.txt
├── .env.example           # Template for SERPAPI_KEY
├── README.md
├── server/                # FastAPI backend
│   ├── app.py             # Routes, Ollama proxy, export
│   ├── reasoning_normalize.py
│   ├── serp_search.py
│   ├── weather.py
│   ├── telemetry.py
│   ├── kill_switch.py
│   └── markdown_export.py
├── static/                # Chat UI (HTML/CSS/JS)
│   ├── index.html
│   ├── main.js
│   ├── style.css
│   ├── components/
│   ├── hooks/
│   ├── storage/
│   └── utils/
├── tests/                 # Unit tests
├── docs/                  # Setup notes (SerpAPI, …)
└── venv/                  # Created by start.bat
```

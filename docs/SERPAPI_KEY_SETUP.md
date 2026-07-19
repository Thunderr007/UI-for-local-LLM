# How to Add Your Own SerpAPI Key

Web search is **optional**. The chat app works without it. Add a key only if you want the **Web** toggle in the message box.

## 1. Get a key

1. Sign up at [serpapi.com](https://serpapi.com/)
2. Copy your API key from the dashboard

## 2. Add the key locally (choose one method)

**Do not upload your real key to GitHub.**  
Only keep it in local files that are listed in `.gitignore`.

### Option A — `serpapikey.env` (simplest)

In the `UI for local LLM` folder, create a file named `serpapikey.env` and paste your key on one line:

```text
your_actual_serpapi_key_here
```

No variable name is needed — just the key.

### Option B — `.env` file

In the `UI for local LLM` folder, copy the template and edit it:

**Windows (PowerShell):**

```powershell
Copy-Item .env.example .env
```

**Mac / Linux:**

```bash
cp .env.example .env
```

Open `.env` and replace the placeholder:

```env
SERPAPI_KEY=your_actual_serpapi_key_here
```

## 3. Restart the app

Close the app and run `start.bat` again, or:

```bash
python app.py
```

The **Web** toggle should enable once your key is detected.

## Safe to commit vs never commit

| File | Upload to GitHub? |
|------|-------------------|
| `docs/SERPAPI_KEY_SETUP.md` (this file) | Yes |
| `.env.example` | Yes (placeholder only) |
| `serpapikey.env` | **No** — contains your real key |
| `.env` | **No** — contains your real key |

Keep keys in the **project root** (`UI for local LLM`), not inside `server/` or `docs/`.

## Troubleshooting

- **Web toggle stays off** — Check that `serpapikey.env` or `.env` is in `UI for local LLM`, then restart the server.
- **Web search fails** — Confirm your key at [serpapi.com](https://serpapi.com/) and check your account quota.

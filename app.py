"""
Local LLM Chat UI — entry point.

Run: python app.py
Or:  start.bat
"""

from server.app import app

__all__ = ["app"]

if __name__ == "__main__":
    import uvicorn

    print("\n  Local LLM Chat UI")
    print("  Open http://127.0.0.1:7860 in your browser\n")
    uvicorn.run(app, host="127.0.0.1", port=7860, log_level="info")

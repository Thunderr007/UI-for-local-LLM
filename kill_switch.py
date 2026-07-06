"""Hard shutdown: flush Ollama VRAM, kill runners, terminate app process tree."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from typing import Any

import httpx
import psutil

OLLAMA_BASE = "http://localhost:11434"
_RUNNER_MARKERS = ("llama-server", "llama_server", "runner")
_OLLAMA_RUNNER_NAMES = {
    "ollama_llama_server.exe",
    "ollama_llama_server",
    "llama-server",
    "llama-server.exe",
}
_CREATE_FLAGS = (
    subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
)


def _terminate(proc: psutil.Process) -> None:
    try:
        proc.terminate()
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return
    try:
        proc.wait(timeout=2)
    except (psutil.TimeoutExpired, psutil.NoSuchProcess):
        try:
            proc.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass


def _unload_via_api() -> None:
    try:
        with httpx.Client(timeout=8.0) as client:
            ps = client.get(f"{OLLAMA_BASE}/api/ps")
            if ps.status_code != 200:
                return
            for entry in ps.json().get("models") or []:
                name = entry.get("name") or entry.get("model")
                if not name:
                    continue
                client.post(
                    f"{OLLAMA_BASE}/api/generate",
                    json={"model": name, "prompt": " ", "stream": False, "keep_alive": 0},
                )
    except Exception:
        pass


def _unload_via_cli() -> None:
    ollama = shutil.which("ollama")
    if not ollama:
        return
    try:
        ps = subprocess.run(
            [ollama, "ps"],
            capture_output=True,
            text=True,
            timeout=8,
            creationflags=_CREATE_FLAGS,
        )
        if ps.returncode != 0:
            return
        for line in ps.stdout.splitlines()[1:]:
            name = line.split()[0] if line.strip() else ""
            if name and name.lower() != "name":
                subprocess.run(
                    [ollama, "stop", name],
                    capture_output=True,
                    timeout=8,
                    creationflags=_CREATE_FLAGS,
                )
    except Exception:
        pass


def _kill_gpu_runners() -> None:
    me = os.getpid()
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            if proc.info["pid"] == me:
                continue
            name = (proc.info["name"] or "").lower()
            cmd = " ".join(proc.info["cmdline"] or []).lower()
            if name in _OLLAMA_RUNNER_NAMES or any(m in cmd for m in _RUNNER_MARKERS):
                for child in proc.children(recursive=True):
                    if child.pid != me:
                        _terminate(child)
                _terminate(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue


def _kill_self_tree() -> None:
    me = os.getpid()
    try:
        root = psutil.Process(me)
        for child in root.children(recursive=True):
            _terminate(child)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        pass
    try:
        _terminate(psutil.Process(me))
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        pass


def execute_kill_switch(delay: float = 0.35) -> dict[str, Any]:
    time.sleep(delay)
    _unload_via_api()
    _unload_via_cli()
    _kill_gpu_runners()
    _kill_self_tree()
    os._exit(0)

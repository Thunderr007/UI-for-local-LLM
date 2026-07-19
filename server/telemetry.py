"""Lean system telemetry sampler — CPU via psutil, GPU/VRAM via nvidia-smi."""

from __future__ import annotations

import shutil
import subprocess
import time
from typing import Any

import psutil

_CACHE: tuple[float, dict[str, Any]] | None = None
_TTL = 2.0
_CPU_PRIMED = False

_CREATE_FLAGS = (
    subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
)


def _nvidia() -> dict[str, Any] | None:
    if not shutil.which("nvidia-smi"):
        return None
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=3,
            creationflags=_CREATE_FLAGS,
        )
        if out.returncode != 0 or not out.stdout.strip():
            return None
        util, used, total = [p.strip() for p in out.stdout.strip().splitlines()[0].split(",")]
        return {
            "gpu_percent": float(util),
            "vram_used_mb": int(float(used)),
            "vram_total_mb": int(float(total)),
        }
    except (OSError, ValueError, subprocess.TimeoutExpired, IndexError):
        return None


def _cpu() -> float:
    global _CPU_PRIMED
    if not _CPU_PRIMED:
        psutil.cpu_percent(interval=None)
        _CPU_PRIMED = True
    return round(psutil.cpu_percent(interval=None), 1)


def _ram() -> tuple[int, int]:
    mem = psutil.virtual_memory()
    return int(mem.used / (1024 * 1024)), int(mem.total / (1024 * 1024))


def sample() -> dict[str, Any]:
    global _CACHE
    now = time.monotonic()
    if _CACHE and now - _CACHE[0] < _TTL:
        return _CACHE[1]

    gpu = _nvidia()
    ram_used, ram_total = _ram()
    ram_pct = round((ram_used / ram_total) * 100, 1) if ram_total else 0.0
    data: dict[str, Any] = {
        "cpu_percent": _cpu(),
        "ram_used_mb": ram_used,
        "ram_total_mb": ram_total,
        "ram_percent": ram_pct,
        "gpu_available": gpu is not None,
        "gpu_percent": gpu["gpu_percent"] if gpu else None,
        "vram_used_mb": gpu["vram_used_mb"] if gpu else None,
        "vram_total_mb": gpu["vram_total_mb"] if gpu else None,
        "ts": int(time.time()),
    }
    _CACHE = (now, data)
    return data

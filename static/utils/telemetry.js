const telCpuFill = document.getElementById("telCpuFill");
const telRamFill = document.getElementById("telRamFill");
const telGpuFill = document.getElementById("telGpuFill");
const telVramFill = document.getElementById("telVramFill");
const telCpuVal = document.getElementById("telCpuVal");
const telRamVal = document.getElementById("telRamVal");
const telGpuVal = document.getElementById("telGpuVal");
const telVramVal = document.getElementById("telVramVal");
const telHint = document.getElementById("telHint");

const TEL_INTERVAL = 2500;
let telTimer = null;

function fmtMb(mb) {
  if (mb == null) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${mb}M`;
}

function setTelBar(fill, val, pct, label) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  fill.style.width = `${p}%`;
  fill.classList.toggle("warn", p >= 70 && p < 90);
  fill.classList.toggle("danger", p >= 90);
  val.textContent = label;
  if (fill.id === "telGpuFill") {
    document.documentElement.style.setProperty("--gpu-intensity", String(p));
  }
}

function renderTelemetry(d) {
  setTelBar(telCpuFill, telCpuVal, d.cpu_percent, `${d.cpu_percent ?? 0}%`);

  const ramPct =
    d.ram_total_mb > 0 ? (d.ram_used_mb / d.ram_total_mb) * 100 : 0;
  setTelBar(
    telRamFill,
    telRamVal,
    ramPct,
    `${fmtMb(d.ram_used_mb)}/${fmtMb(d.ram_total_mb)}`
  );

  if (d.gpu_available) {
    setTelBar(telGpuFill, telGpuVal, d.gpu_percent, `${Math.round(d.gpu_percent)}%`);
    const vramPct =
      d.vram_total_mb > 0 ? (d.vram_used_mb / d.vram_total_mb) * 100 : 0;
    setTelBar(
      telVramFill,
      telVramVal,
      vramPct,
      `${fmtMb(d.vram_used_mb)}/${fmtMb(d.vram_total_mb)}`
    );
    telHint.textContent = "Live · NVIDIA GPU";
  } else {
    telGpuFill.style.width = "0%";
    telGpuVal.textContent = "N/A";
    telVramFill.style.width = "0%";
    telVramVal.textContent = "N/A";
    telHint.textContent = "No NVIDIA GPU detected (nvidia-smi)";
  }
}

async function pollTelemetry() {
  if (document.hidden) return;
  try {
    const res = await fetch("/api/telemetry");
    if (res.ok) renderTelemetry(await res.json());
  } catch {
    telHint.textContent = "Telemetry unavailable";
  }
}

function initTelemetry() {
  pollTelemetry();
  telTimer = setInterval(pollTelemetry, TEL_INTERVAL);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollTelemetry();
  });
}

initTelemetry();

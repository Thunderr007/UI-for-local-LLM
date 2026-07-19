/**
 * Generation progress bar — capability-aware steps + live token counter.
 * @param {{thinking:boolean, webSearch:boolean, weather?:boolean}} caps
 * @param {Array<{id:string,label:string,pct:number}>} allSteps
 */
export function createGenerationProgress(caps, allSteps) {
  const steps = allSteps.filter((s) => {
    // Thought process step is always available; models may still emit no trace.
    if (s.id === "thinking") return true;
    if (s.id === "search") return caps.webSearch;
    if (s.id === "weather") return Boolean(caps.weather);
    return s.id !== "done" && s.id !== "tools";
  });

  const root = document.createElement("div");
  root.className = "gen-progress";
  root.dataset.thinking = "1";
  root.innerHTML = `
    <div class="gen-progress-top">
      <span class="gen-stage">Preparing…</span>
      <span class="gen-tokens" aria-live="polite" aria-atomic="true">Waiting…</span>
      <span class="gen-time">0.0s</span>
    </div>
    <div class="gen-bar"><div class="gen-bar-fill"></div></div>
    <div class="gen-steps"></div>`;

  const stageEl = root.querySelector(".gen-stage");
  const tokensEl = root.querySelector(".gen-tokens");
  const timeEl = root.querySelector(".gen-time");
  const fillEl = root.querySelector(".gen-bar-fill");
  const stepsEl = root.querySelector(".gen-steps");

  steps.forEach((step) => {
    const span = document.createElement("span");
    span.className = "gen-step";
    span.dataset.step = step.id;
    span.textContent = step.label;
    stepsEl.appendChild(span);
  });

  const started = performance.now();
  const timerId = setInterval(() => {
    timeEl.textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
  }, 100);

  const stepIndex = (id) => allSteps.findIndex((s) => s.id === id);

  function updateSteps(activeId) {
    const activeIdx = stepIndex(activeId);
    stepsEl.querySelectorAll(".gen-step").forEach((el) => {
      const idx = stepIndex(el.dataset.step);
      el.classList.remove("active", "done");
      if (idx < activeIdx) el.classList.add("done");
      else if (idx === activeIdx) el.classList.add("active");
    });
  }

  function setStage(stepId, label, extraPct) {
    const step = allSteps.find((s) => s.id === stepId) || allSteps[0];
    stageEl.textContent = label || step.label;
    fillEl.style.width = `${extraPct ?? step.pct}%`;
    root.classList.toggle(
      "loading",
      ["weather", "search", "load", "prompt", "thinking"].includes(stepId)
    );
    updateSteps(stepId);
  }

  function formatMs(ns) {
    if (!ns) return null;
    const ms = Number(ns) / 1e6;
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  function buildSummary(stats) {
    const parts = [];
    if (stats.prompt_eval_count != null) {
      parts.push(`Prompt <strong>${stats.prompt_eval_count}</strong>`);
    }
    if (stats.thinking_eval_count != null) {
      parts.push(`Think <strong>${stats.thinking_eval_count}</strong>`);
    }
    if (stats.eval_count != null) {
      parts.push(`Out <strong>${stats.eval_count}</strong>`);
    }
    if (stats.eval_duration && stats.eval_count) {
      const tps = (
        Number(stats.eval_count) / (Number(stats.eval_duration) / 1e9)
      ).toFixed(1);
      parts.push(`<strong>${tps}</strong> tok/s`);
    }
    if (stats.total_duration) parts.push(formatMs(stats.total_duration));
    return parts.join(" · ");
  }

  function updateLiveTokens(metrics) {
    tokensEl.classList.remove("hidden");
    const bits = [];
    if (metrics.phase === "thinking") {
      bits.push(`Thought process ~${metrics.thinkingTokens || 0} tok`);
    } else if (metrics.phase === "generating") {
      if (metrics.thinkingTokens) bits.push(`Think ~${metrics.thinkingTokens}`);
      bits.push(`Out ~${metrics.contentTokens || 0} tok`);
    } else if (metrics.phase === "loading") {
      bits.push("Loading model…");
    } else {
      bits.push("Waiting…");
    }
    tokensEl.textContent = bits.join(" · ");
  }

  setStage("prepare", "Preparing request…");
  updateLiveTokens({ phase: "loading" });

  return {
    root,
    setStage,
    updateLiveTokens,
    setGeneratingProgress: (n) => {
      fillEl.style.width = `${75 + Math.min(22, n / 25)}%`;
    },
    finish: (stats) => {
      clearInterval(timerId);
      timeEl.textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
      setStage("done", "Complete", 100);
      root.classList.remove("loading");
      root.classList.add("gen-progress-done");
      if (stats && Object.keys(stats).length) {
        tokensEl.innerHTML = buildSummary(stats);
        const s = document.createElement("div");
        s.className = "gen-summary";
        s.innerHTML = buildSummary(stats);
        root.appendChild(s);
      }
    },
    fail: (message) => {
      clearInterval(timerId);
      stageEl.textContent = "Failed";
      tokensEl.textContent = message;
      fillEl.style.width = "100%";
      fillEl.style.background = "var(--danger)";
      const s = document.createElement("div");
      s.className = "gen-summary";
      s.style.color = "var(--danger)";
      s.textContent = message;
      root.appendChild(s);
    },
  };
}

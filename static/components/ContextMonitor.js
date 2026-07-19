import { CATEGORY_META } from "../utils/contextCalc.js";

/**
 * @param {number} n
 */
function fmtTok(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Presentational /context widget — no math, snapshot in → DOM update.
 * @param {HTMLElement} root
 * @param {import('../utils/contextCalc.js').ContextSnapshot} snapshot
 */
export function renderContextMonitor(root, snapshot) {
  if (!root._ctxMounted) {
    root.innerHTML = `
      <div class="ctxmon">
        <div class="ctxmon-head">
          <span class="ctxmon-path">Context usage</span>
          <span class="ctxmon-meta" data-el="meta"></span>
        </div>
        <div class="ctxmon-grid" data-el="grid" role="img" aria-label="Context window map"></div>
        <ul class="ctxmon-list" data-el="list"></ul>
        <div class="ctxmon-foot" data-el="foot"></div>
      </div>`;
    root._ctxMounted = true;
  }

  const meta = root.querySelector('[data-el="meta"]');
  const grid = root.querySelector('[data-el="grid"]');
  const list = root.querySelector('[data-el="list"]');
  const foot = root.querySelector('[data-el="foot"]');

  meta.textContent = `${snapshot.modelName || "—"} · ${fmtTok(snapshot.usedTokens)}/${fmtTok(snapshot.maxTokens)}`;

  grid.replaceChildren();
  snapshot.grid.forEach((key) => {
    const cell = document.createElement("span");
    cell.className = `ctxmon-cell cat-${key}`;
    cell.title = CATEGORY_META[key]?.label || key;
    grid.appendChild(cell);
  });

  list.replaceChildren();
  snapshot.breakdown.forEach((row) => {
    if (row.tokens === 0 && row.key !== "autocompactBuffer") return;
    const li = document.createElement("li");
    li.className = `ctxmon-row cat-${row.key}`;
    li.innerHTML = `
      <span class="ctxmon-swatch"></span>
      <span class="ctxmon-label">${row.label}</span>
      <span class="ctxmon-pct">${row.percent}%</span>
      <span class="ctxmon-tok">${fmtTok(row.tokens)}</span>`;
    list.appendChild(li);
  });

  const buf = snapshot.breakdown.find((r) => r.key === "autocompactBuffer");
  foot.textContent = buf
    ? `Autocompact buffer: ${fmtTok(buf.tokens)} (${buf.percent}%) · 1 block ≈ ${fmtTok(snapshot.blockTokens)} tok`
    : `1 block ≈ ${fmtTok(snapshot.blockTokens)} tok`;
}

/**
 * @param {HTMLElement} mount
 * @param {import('../utils/contextCalc.js').ContextInput} input
 * @param {typeof import('../utils/contextCalc.js').computeContextSnapshot} compute
 */
export function mountContextMonitor(mount, input, compute) {
  renderContextMonitor(mount, compute(input));
}

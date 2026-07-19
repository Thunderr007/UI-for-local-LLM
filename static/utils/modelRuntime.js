/**
 * Model catalog + selection — single source of truth for LLM state changes.
 * @typedef {{name:string,context_length:number,labels:object[],support:object,digest?:string,modified_at?:string,capabilities?:string[]}} ModelInfo
 */

/** @type {Record<string, ModelInfo>} */
let catalog = {};
let selectedName = "";
/** @type {Set<(evt: {type:string, catalog:Record<string,ModelInfo>, selected:string, prevSelected?:string})=>void>} */
const listeners = new Set();

/** Installed-set identity: name + digest + modified (safe for /api/tags polls). */
export function catalogFingerprint(models) {
  const rows = Array.isArray(models) ? models : Object.values(models || {});
  return rows
    .map((m) => {
      const name = m.name || m.model || "";
      const digest = m.digest || "";
      const modified = m.modified_at || m.modified || "";
      return `${name}\t${digest}\t${modified}`;
    })
    .sort()
    .join("\0");
}

/** Full catalog fingerprint including capabilities (for UI refresh). */
export function catalogContentFingerprint(models) {
  const rows = Array.isArray(models) ? models : Object.values(models || {});
  return rows
    .map((m) => {
      const base = `${m.name || ""}\t${m.digest || ""}\t${m.modified_at || ""}`;
      const caps = (m.capabilities || []).slice().sort().join(",");
      const thinking = m.support?.thinking ? "1" : "0";
      return `${base}\t${caps}\t${thinking}`;
    })
    .sort()
    .join("\0");
}

/**
 * @param {ModelInfo[]} models
 * @returns {boolean} true if catalog content changed
 */
export function setCatalog(models) {
  const next = {};
  for (const m of models) {
    next[m.name] = m;
  }
  const listChanged =
    catalogContentFingerprint(catalog) !== catalogContentFingerprint(next);
  catalog = next;
  if (listChanged) {
    notify("list");
  }
  return listChanged;
}

/** @returns {Record<string, ModelInfo>} */
export function getCatalog() {
  return { ...catalog };
}

export function getSelectedName() {
  return selectedName;
}

/** Short display label for avatar (strips Ollama tag, caps length). */
export function shortModelName(fullName) {
  if (!fullName) return "AI";
  const base = fullName.split(":")[0];
  const maxLen = 10;
  if (base.length <= maxLen) return base;
  return `${base.slice(0, maxLen - 1)}…`;
}

/** @returns {ModelInfo | null} */
export function getSelectedInfo() {
  return catalog[selectedName] || null;
}

/**
 * @param {string} name
 * @param {{silent?: boolean}} [opts]
 */
export function setSelectedName(name, opts = {}) {
  if (!name || !catalog[name]) return false;
  if (selectedName === name) return true;
  const prev = selectedName;
  selectedName = name;
  if (!opts.silent) notify("select", prev);
  return true;
}

/**
 * Pick best default when current selection is missing after reload.
 * @param {string} [prefer]
 */
export function reconcileSelection(prefer) {
  const names = Object.keys(catalog);
  if (!names.length) {
    selectedName = "";
    notify("select");
    return "";
  }
  if (selectedName && catalog[selectedName]) return selectedName;
  if (prefer && catalog[prefer]) {
    selectedName = prefer;
    notify("select");
    return selectedName;
  }
  const stored = localStorage.getItem("llm_last_model");
  if (stored && catalog[stored]) {
    selectedName = stored;
    notify("select");
    return selectedName;
  }
  const thinking = names.find((n) => catalog[n]?.support?.thinking);
  const vision = names.find((n) => catalog[n]?.support?.images);
  selectedName = thinking || vision || names[0];
  notify("select");
  return selectedName;
}

export function persistSelectedName() {
  if (selectedName) localStorage.setItem("llm_last_model", selectedName);
}

/**
 * @param {(evt: {type:string, catalog:Record<string,ModelInfo>, selected:string, prevSelected?:string})=>void} fn
 */
export function subscribeModels(fn) {
  listeners.add(fn);
  fn({ type: "init", catalog: getCatalog(), selected: selectedName });
  return () => listeners.delete(fn);
}

function notify(type, prevSelected) {
  const evt = {
    type,
    catalog: getCatalog(),
    selected: selectedName,
    prevSelected,
  };
  listeners.forEach((fn) => fn(evt));
}

/** @param {ModelInfo | null} info */
export function modelCapabilities(info) {
  const webToggle = document.getElementById("webSearchToggle");
  return {
    thinking: Boolean(info?.support?.thinking),
    images: Boolean(info?.support?.images),
    tools: Boolean(info?.support?.tools),
    webSearch: Boolean(webToggle?.checked && !webToggle.disabled),
    weather: false,
  };
}

import { createSessionStore } from "./hooks/useChatSession.js";
import { renderChatHistory } from "./components/ChatHistorySidebar.js";
import { renderHistoryDropdown } from "./components/HistoryDropdown.js";
import { renderExportMenu } from "./components/ExportMenu.js";
import { downloadTxt, downloadServerExport } from "./utils/chatExport.js";
import {
  renderMessageTimeline,
  appendAssistantShell,
  mountSourceChips,
} from "./components/MessageTimeline.js";
import { createStreamRenderer } from "./utils/streamRenderer.js";
import { escapeHtml } from "./utils/markdown.js";
import { clearInputSuggestion } from "./utils/promptSuggestions.js";
import { createGenerationProgress } from "./components/GenerationProgress.js";
import { showAlert, showConfirm, showPrompt } from "./components/Modal.js";
import { bindCommandPalette } from "./components/CommandPalette.js";
import {
  catalogFingerprint,
  getCatalog,
  getSelectedInfo,
  getSelectedName,
  modelCapabilities,
  persistSelectedName,
  reconcileSelection,
  setCatalog,
  setSelectedName,
  subscribeModels,
} from "./utils/modelRuntime.js";

const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const modelSelect = document.getElementById("modelSelect");
const statusBadge = document.getElementById("statusBadge");
const newChatBtn = document.getElementById("newChatBtn");
const imageInput = document.getElementById("imageInput");
const docInput = document.getElementById("docInput");
const attachmentsEl = document.getElementById("attachments");
const ctxSlider = document.getElementById("ctxSlider");
const ctxValue = document.getElementById("ctxValue");
const ctxPresets = document.getElementById("ctxPresets");
const ctxHint = document.getElementById("ctxHint");
const ctxLive = document.getElementById("ctxLive");
const ctxLiveText = document.getElementById("ctxLiveText");
const modelLabelsEl = document.getElementById("modelLabels");
const modelHintEl = document.getElementById("modelHint");
const imageAttachBtn = document.getElementById("imageAttachBtn");
const docAttachBtn = document.getElementById("docAttachBtn");
const webSearchToggle = document.getElementById("webSearchToggle");
const webSearchLabel = document.getElementById("webSearchLabel");
const shareLocationToggle = document.getElementById("shareLocationToggle");
const locStatus = document.getElementById("locStatus");
const chatHistoryList = document.getElementById("chatHistoryList");
const riskBadge = document.getElementById("riskBadge");
const riskMsg = document.getElementById("riskMsg");
const riskPanel = document.getElementById("riskPanel");
const riskBanner = document.getElementById("riskBanner");
const sessionTitleEl = document.getElementById("sessionTitle");
const connectionText = document.getElementById("connectionText");
const connectionDot = document.getElementById("connectionDot");
const historyDropdownMount = document.getElementById("historyDropdownMount");
const genProgressToast = document.getElementById("genProgressToast");
const exportMenuMount = document.getElementById("exportMenuMount");
const tempSlider = document.getElementById("tempSlider");
const tempValue = document.getElementById("tempValue");
const topPSlider = document.getElementById("topPSlider");
const topPValue = document.getElementById("topPValue");
const topKSlider = document.getElementById("topKSlider");
const topKValue = document.getElementById("topKValue");
const maxTokensSlider = document.getElementById("maxTokensSlider");
const maxTokensValue = document.getElementById("maxTokensValue");
const repeatPenaltySlider = document.getElementById("repeatPenaltySlider");
const repeatPenaltyValue = document.getElementById("repeatPenaltyValue");
const genPresetsEl = document.getElementById("genPresets");
const store = await createSessionStore();
let pendingImages = [];
let pendingDoc = null;
let isGenerating = false;
let editingMessageId = null;
let selectedNumCtx = 4096;
let lastMeasuredTokens = 0;
let lastModelFingerprint = "";
let exportBusy = false;
const CTX_PRESETS = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144];

const GEN_DEFAULTS = {
  temperature: 0.8,
  top_p: 0.9,
  top_k: 40,
  num_predict: 2048,
  repeat_penalty: 1.1,
};

const GEN_PRESETS = {
  fast: {
    temperature: 0.3,
    top_p: 0.8,
    top_k: 20,
    num_predict: 512,
    repeat_penalty: 1.1,
  },
  balanced: {
    temperature: 0.8,
    top_p: 0.9,
    top_k: 40,
    num_predict: 2048,
    repeat_penalty: 1.1,
  },
  creative: {
    temperature: 1.3,
    top_p: 0.95,
    top_k: 80,
    num_predict: 4096,
    repeat_penalty: 1.05,
  },
};

let genSettings = { ...GEN_DEFAULTS };

const GEN_STEPS = [
  { id: "prepare", label: "Prepare", pct: 8 },
  { id: "send", label: "Send", pct: 18 },
  { id: "weather", label: "Weather", pct: 24 },
  { id: "search", label: "Search", pct: 32 },
  { id: "load", label: "Load", pct: 40 },
  { id: "prompt", label: "Prompt", pct: 52 },
  { id: "thinking", label: "Think", pct: 62 },
  { id: "generate", label: "Generate", pct: 75 },
  { id: "done", label: "Done", pct: 100 },
];

const GEO_CACHE_KEY = "shareLocationCoords";
const GEO_ENABLED_KEY = "shareLocationEnabled";
const GEO_TTL_MS = 60 * 60 * 1000;
const GEO_TIMEOUT_MS = 15000;

function activeMessages() {
  return store.getActiveSession()?.messages ?? [];
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function updateSessionHeader() {
  const session = store.getActiveSession();
  if (sessionTitleEl) {
    sessionTitleEl.textContent = session?.title || "New chat";
  }
}

function initSidebarAccordions() {
  const keys = [
    "accordionChat",
    "accordionModel",
    "accordionContext",
    "accordionLocation",
    "accordionSystem",
  ];
  keys.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const stored = localStorage.getItem(`accordion_${id}`);
    if (stored === "closed") el.removeAttribute("open");
    if (stored === "open") el.setAttribute("open", "");
    el.addEventListener("toggle", () => {
      localStorage.setItem(`accordion_${id}`, el.open ? "open" : "closed");
    });
  });
}

/** @returns {{lat:number, lon:number, ts:number, elev?:number|null} | null} */
function readGeoCache() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (
      !data ||
      typeof data.lat !== "number" ||
      typeof data.lon !== "number" ||
      typeof data.ts !== "number"
    ) {
      return null;
    }
    if (Date.now() - data.ts > GEO_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeGeoCache(lat, lon, elev = null) {
  const payload = { lat, lon, ts: Date.now() };
  if (typeof elev === "number" && Number.isFinite(elev)) {
    payload.elev = elev;
  }
  localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(payload));
}

function formatCacheExpiry(ts) {
  const until = new Date(ts + GEO_TTL_MS);
  return until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function setLocStatus(text, kind = "") {
  if (!locStatus) return;
  locStatus.textContent = text;
  locStatus.classList.remove("is-ok", "is-error");
  if (kind) locStatus.classList.add(kind);
}

/** Fresh coords only when sharing is enabled. */
function getSharedCoords() {
  if (!shareLocationToggle?.checked) return null;
  return readGeoCache();
}

function formatCoordsStatus(cached) {
  const base = `Cached until ${formatCacheExpiry(cached.ts)} · ${cached.lat.toFixed(4)}, ${cached.lon.toFixed(4)}`;
  if (typeof cached.elev === "number" && Number.isFinite(cached.elev)) {
    return `${base} · ~${Math.round(cached.elev)} m`;
  }
  return base;
}

function requestGeolocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: GEO_TIMEOUT_MS,
      maximumAge: 0,
    });
  });
}

async function enableShareLocation() {
  const cached = readGeoCache();
  if (cached) {
    setLocStatus(formatCoordsStatus(cached), "is-ok");
    localStorage.setItem(GEO_ENABLED_KEY, "1");
    return true;
  }

  setLocStatus("Locating (high accuracy)…");
  try {
    const pos = await requestGeolocation();
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const elev =
      typeof pos.coords.altitude === "number" && Number.isFinite(pos.coords.altitude)
        ? pos.coords.altitude
        : null;
    writeGeoCache(lat, lon, elev);
    const saved = readGeoCache() || { lat, lon, ts: Date.now(), elev };
    setLocStatus(formatCoordsStatus(saved), "is-ok");
    localStorage.setItem(GEO_ENABLED_KEY, "1");
    return true;
  } catch (err) {
    if (shareLocationToggle) shareLocationToggle.checked = false;
    localStorage.setItem(GEO_ENABLED_KEY, "0");
    const denied = err?.code === 1 || /denied/i.test(String(err?.message || ""));
    setLocStatus(
      denied ? "Denied — enable location in browser settings" : "Unavailable — weather not sent",
      "is-error"
    );
    return false;
  }
}

function disableShareLocation() {
  localStorage.setItem(GEO_ENABLED_KEY, "0");
  setLocStatus("Off — weather not sent with chats");
}

function initShareLocation() {
  if (!shareLocationToggle) return;

  const wantOn = localStorage.getItem(GEO_ENABLED_KEY) === "1";
  if (wantOn) {
    shareLocationToggle.checked = true;
    const cached = readGeoCache();
    if (cached) {
      setLocStatus(formatCoordsStatus(cached), "is-ok");
    } else {
      enableShareLocation();
    }
  } else {
    shareLocationToggle.checked = false;
    setLocStatus("Off — weather not sent with chats");
  }

  shareLocationToggle.addEventListener("change", async () => {
    if (shareLocationToggle.checked) {
      await enableShareLocation();
    } else {
      disableShareLocation();
    }
  });
}

function syncUI() {
  const state = store.getState();
  const historyHandlers = {
    onSelect: (id) => {
      if (isGenerating) return;
      editingMessageId = null;
      store.setActive(id);
      lastMeasuredTokens = 0;
      syncUI();
    },
    onDelete: (id) => {
      if (isGenerating) return;
      store.deleteSession(id);
      editingMessageId = null;
      lastMeasuredTokens = 0;
      syncUI();
    },
    onRename: (id, title) => {
      store.renameSession(id, title);
      syncUI();
    },
    onNew: () => newChat(),
    disabled: isGenerating,
  };

  renderChatHistory(chatHistoryList, state, historyHandlers);

  if (historyDropdownMount) {
    renderHistoryDropdown(historyDropdownMount, state, {
      onSelect: historyHandlers.onSelect,
      onDelete: historyHandlers.onDelete,
      onNew: historyHandlers.onNew,
      disabled: historyHandlers.disabled,
    });
  }

  renderExportMenuUI();
  updateSessionHeader();

  if (!isGenerating) {
    renderMessageTimeline(messagesEl, activeMessages(), {
      editingId: editingMessageId,
      onEdit: (id, newContent, enterEdit, cancel) => {
        if (isGenerating) return;
        if (cancel) {
          editingMessageId = null;
          syncUI();
          return;
        }
        if (enterEdit) {
          editingMessageId = id;
          syncUI();
          return;
        }
        if (newContent) {
          const session = store.getActiveSession();
          if (!session) return;
          editingMessageId = null;
          store.editUserMessage(session.id, id, newContent);
          lastMeasuredTokens = 0;
          syncUI();
          runGeneration({ branchFromEdit: true });
        }
      },
    });
  }

  updateContextDisplay();
  refreshModelDependentUI();
}

function refreshModelDependentUI() {
  renderModelLabels();
  modelSelect.disabled = isGenerating;
  const info = getSelectedModelInfo();
  const caps = modelCapabilities(info);
  document.body.dataset.thinkingModel = "1";
  const hint = document.getElementById("modelThinkingHint");
  if (hint) {
    hint.textContent = caps.thinking
      ? "Thought process + live tokens enabled for this model"
      : "Thought process panel always shown — this model may not expose a trace";
    hint.classList.remove("hidden");
  }
}

function onModelStateChanged() {
  const name = getSelectedName();
  if (modelSelect.value !== name) {
    modelSelect.value = name;
  }
  applyModelContextSettings({ skipSelect: true });
  refreshModelDependentUI();
  if (!isGenerating) {
    updateContextDisplay();
  }
}

function formatCtx(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}M`;
  if (n >= 1024) return `${Math.round(n / 1024)}K`;
  return String(n);
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

function estimatePendingTokens() {
  let total = estimateTokens(userInput.value);
  total += pendingImages.length * 768;
  return total;
}

function estimateConversationTokens() {
  let total = activeMessages().reduce((sum, m) => sum + estimateTokens(m.content), 0);
  total += estimatePendingTokens();
  if (lastMeasuredTokens > total) total = lastMeasuredTokens;
  return total;
}

function hallucinationRisk(pct) {
  if (pct >= 80) return "danger";
  if (pct >= 60) return "warn";
  return "safe";
}

const RISK_COPY = {
  safe: { badge: "Safe", msg: "Context under 60% — model retains earlier details reliably." },
  warn: { badge: "Elevated", msg: "60–80% full — earlier context may weaken; consider a new chat soon." },
  danger: { badge: "High risk", msg: "Over 80% full — model may lose track or invent details." },
};

function updateRiskIndicator(pct, state) {
  const copy = RISK_COPY[state] || RISK_COPY.safe;
  riskBadge.textContent = copy.badge;
  riskBadge.className = `risk-badge ${state}`;
  riskMsg.textContent = copy.msg;
  riskPanel.className = `risk-panel ${state}`;
  riskBanner.classList.toggle("hidden", state !== "danger");
}

function refreshContextMonitor() {
  if (!window.ContextWidget) return;
  const mount = document.getElementById("contextMonitor");
  if (mount && !mount.dataset.ready) {
    window.ContextWidget.initContextWidget(mount);
    mount.dataset.ready = "1";
  }
  window.ContextWidget.refreshContextWidget({
    modelName: getSelectedName() || modelSelect.value || "—",
    maxTokens: selectedNumCtx,
    messageTokens: estimateConversationTokens(),
  });
}

function updateContextDisplay() {
  const used = estimateConversationTokens();
  const limit = selectedNumCtx;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const state = hallucinationRisk(pct);
  ctxValue.textContent = formatCtx(limit);
  updateRiskIndicator(pct, state);
  refreshContextMonitor();
  ctxLive.className = "ctx-live";
  if (state === "warn") ctxLive.classList.add("warn");
  if (state === "danger") ctxLive.classList.add("danger");
  const riskLabel = state === "safe" ? "Safe" : state === "warn" ? "Elevated" : "High risk";
  ctxLiveText.textContent = `Context: ${formatCtx(used)} / ${formatCtx(limit)} (${Math.round(pct)}%) · ${riskLabel}`;
}

function getModelMaxCtx(name) {
  return getCatalog()[name]?.context_length || 8192;
}

function getStoredCtx(name) {
  const raw = localStorage.getItem(`ctx_${name}`);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

function storeCtx(name, value) {
  localStorage.setItem(`ctx_${name}`, String(value));
}

function defaultCtxForModel(name) {
  const max = getModelMaxCtx(name);
  const stored = getStoredCtx(name);
  if (stored) return Math.min(stored, max);
  if (max <= 4096) return max;
  if (max <= 8192) return 4096;
  return 8192;
}

function renderCtxPresets(maxCtx) {
  ctxPresets.innerHTML = "";
  CTX_PRESETS.filter((p) => p <= maxCtx).forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctx-preset";
    btn.textContent = formatCtx(preset);
    btn.dataset.value = String(preset);
    if (preset === selectedNumCtx) btn.classList.add("active");
    btn.addEventListener("click", () => setNumCtx(preset));
    ctxPresets.appendChild(btn);
  });
}

function setNumCtx(value, persist = true) {
  const model = modelSelect.value;
  const max = model ? getModelMaxCtx(model) : 262144;
  selectedNumCtx = Math.max(512, Math.min(value, max));
  ctxSlider.value = String(selectedNumCtx);
  ctxSlider.max = String(max);
  if (persist && model) storeCtx(model, selectedNumCtx);
  ctxPresets.querySelectorAll(".ctx-preset").forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.value, 10) === selectedNumCtx);
  });
  updateContextDisplay();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function roundTo(n, step) {
  const precision = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  const rounded = Math.round(n / step) * step;
  return Number(rounded.toFixed(precision));
}

function normalizeGenSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const temperature = Number.isFinite(Number(src.temperature))
    ? clamp(roundTo(Number(src.temperature), 0.1), 0, 2)
    : GEN_DEFAULTS.temperature;
  const top_p = Number.isFinite(Number(src.top_p))
    ? clamp(roundTo(Number(src.top_p), 0.05), 0, 1)
    : GEN_DEFAULTS.top_p;
  const top_k = Number.isFinite(Number(src.top_k))
    ? clamp(Math.round(Number(src.top_k)), 1, 100)
    : GEN_DEFAULTS.top_k;
  let num_predict = GEN_DEFAULTS.num_predict;
  if (src.num_predict === 0 || src.num_predict === "0") {
    num_predict = 0;
  } else if (Number.isFinite(Number(src.num_predict))) {
    num_predict = clamp(Math.round(Number(src.num_predict)), 0, 8192);
    if (num_predict > 0) num_predict = Math.max(64, roundTo(num_predict, 64));
  }
  const repeat_penalty = Number.isFinite(Number(src.repeat_penalty))
    ? clamp(roundTo(Number(src.repeat_penalty), 0.05), 0.5, 2)
    : GEN_DEFAULTS.repeat_penalty;
  return { temperature, top_p, top_k, num_predict, repeat_penalty };
}

function getStoredGen(name) {
  try {
    const raw = localStorage.getItem(`gen_${name}`);
    if (!raw) return null;
    return normalizeGenSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

function storeGen(name, settings) {
  localStorage.setItem(
    `gen_${name}`,
    JSON.stringify({
      temperature: settings.temperature,
      top_p: settings.top_p,
      top_k: settings.top_k,
      num_predict: settings.num_predict,
      repeat_penalty: settings.repeat_penalty,
    })
  );
}

function matchingGenPreset(settings) {
  for (const [id, preset] of Object.entries(GEN_PRESETS)) {
    if (
      settings.temperature === preset.temperature &&
      settings.top_p === preset.top_p &&
      settings.top_k === preset.top_k &&
      settings.num_predict === preset.num_predict &&
      settings.repeat_penalty === preset.repeat_penalty
    ) {
      return id;
    }
  }
  return null;
}

function syncGenControlsFromState() {
  tempSlider.value = String(genSettings.temperature);
  tempValue.textContent = String(genSettings.temperature);
  topPSlider.value = String(genSettings.top_p);
  topPValue.textContent = String(genSettings.top_p);
  topKSlider.value = String(genSettings.top_k);
  topKValue.textContent = String(genSettings.top_k);
  const maxTok = genSettings.num_predict > 0 ? genSettings.num_predict : 64;
  maxTokensSlider.value = String(maxTok);
  maxTokensValue.textContent =
    genSettings.num_predict > 0 ? String(genSettings.num_predict) : "off";
  repeatPenaltySlider.value = String(genSettings.repeat_penalty);
  repeatPenaltyValue.textContent = String(genSettings.repeat_penalty);
  const active = matchingGenPreset(genSettings);
  genPresetsEl.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.preset === active);
  });
}

function persistGenIfModel() {
  const model = getSelectedName() || modelSelect.value;
  if (model) storeGen(model, genSettings);
}

function updateGenFromControls(persist = true) {
  genSettings = normalizeGenSettings({
    temperature: parseFloat(tempSlider.value),
    top_p: parseFloat(topPSlider.value),
    top_k: parseInt(topKSlider.value, 10),
    num_predict: parseInt(maxTokensSlider.value, 10),
    repeat_penalty: parseFloat(repeatPenaltySlider.value),
  });
  syncGenControlsFromState();
  if (persist) persistGenIfModel();
}

function applyGenPreset(id, persist = true) {
  const preset = GEN_PRESETS[id];
  if (!preset) return;
  genSettings = normalizeGenSettings({
    ...genSettings,
    ...preset,
  });
  syncGenControlsFromState();
  if (persist) persistGenIfModel();
}

function applyModelGenSettings() {
  const model = getSelectedName() || modelSelect.value;
  if (!model) {
    genSettings = normalizeGenSettings(GEN_DEFAULTS);
  } else {
    genSettings = getStoredGen(model) || normalizeGenSettings(GEN_DEFAULTS);
  }
  syncGenControlsFromState();
}

function appendGenOptionsToForm(formData) {
  const s = genSettings;
  if (Number.isFinite(s.temperature) && s.temperature >= 0 && s.temperature <= 2) {
    formData.append("temperature", String(s.temperature));
  }
  if (Number.isFinite(s.top_p) && s.top_p >= 0 && s.top_p <= 1) {
    formData.append("top_p", String(s.top_p));
  }
  if (Number.isFinite(s.top_k) && s.top_k >= 1 && s.top_k <= 100) {
    formData.append("top_k", String(s.top_k));
  }
  if (Number.isFinite(s.num_predict) && s.num_predict >= 1) {
    formData.append("num_predict", String(s.num_predict));
  }
  if (Number.isFinite(s.repeat_penalty) && s.repeat_penalty >= 0.5 && s.repeat_penalty <= 2) {
    formData.append("repeat_penalty", String(s.repeat_penalty));
  }
}

function getSelectedModelInfo() {
  return getSelectedInfo();
}

function formatModelTags(labels) {
  const inputs = (labels || []).filter((l) =>
    ["text", "images", "pdf", "docx", "txt"].includes(l.id)
  );
  return inputs
    .filter((l) => l.status !== "no")
    .map((l) => (l.status === "partial" ? `${l.label}*` : l.label))
    .join(" · ");
}

function renderModelLabels() {
  const info = getSelectedModelInfo();
  modelLabelsEl.innerHTML = "";
  if (!info?.labels?.length) return;
  info.labels.forEach((cap) => {
    const chip = document.createElement("span");
    chip.className = `cap-chip ${cap.status}`;
    chip.textContent = cap.label;
    chip.title = cap.hint;
    modelLabelsEl.appendChild(chip);
  });
  modelHintEl.textContent = formatModelTags(info.labels)
    ? `Supports: ${formatModelTags(info.labels)}`
    : "Labels show what each model can handle.";
  updateAttachmentButtons();
}

function updateAttachmentButtons() {
  const info = getSelectedModelInfo();
  const imagesOk = info?.support?.images ?? false;
  imageAttachBtn.classList.toggle("blocked", !imagesOk);
  imageAttachBtn.title = imagesOk
    ? "Attach image (JPG, PNG, WebP…)"
    : "Current model cannot read images — select a vision model (e.g. qwen3.5:9b)";
  docAttachBtn.classList.remove("blocked");
}

function applyModelContextSettings(opts = {}) {
  const model = opts.skipSelect ? getSelectedName() : modelSelect.value;
  if (!model) return;
  if (!opts.skipSelect) {
    setSelectedName(model);
    persistSelectedName();
  }
  const max = getModelMaxCtx(model);
  ctxHint.textContent = `Model max: ${formatCtx(max)} tokens · applies on next message`;
  ctxSlider.min = "512";
  ctxSlider.max = String(max);
  ctxSlider.step = max > 32768 ? "2048" : "512";
  setNumCtx(defaultCtxForModel(model), false);
  renderCtxPresets(max);
  applyModelGenSettings();
  renderModelLabels();
  if (!getSelectedModelInfo()?.support?.images && pendingImages.length) {
    pendingImages = [];
    renderAttachmentPills();
    updateSendState();
  }
  refreshModelDependentUI();
}

function updateSendState() {
  const hasText = userInput.value.trim().length > 0;
  const hasFiles = pendingImages.length > 0 || pendingDoc;
  sendBtn.disabled = isGenerating || (!hasText && !hasFiles);
}

function renderAttachmentPills() {
  attachmentsEl.innerHTML = "";
  pendingImages.forEach((file, idx) => {
    const pill = document.createElement("div");
    pill.className = "attachment-pill";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    const span = document.createElement("span");
    span.textContent = file.name;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "×";
    btn.onclick = () => {
      pendingImages.splice(idx, 1);
      renderAttachmentPills();
      updateSendState();
      updateContextDisplay();
    };
    pill.append(img, span, btn);
    attachmentsEl.appendChild(pill);
  });
  if (pendingDoc) {
    const pill = document.createElement("div");
    pill.className = "attachment-pill doc";
    const span = document.createElement("span");
    span.textContent = `📄 ${pendingDoc.name}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "×";
    btn.onclick = () => {
      pendingDoc = null;
      renderAttachmentPills();
      updateSendState();
      updateContextDisplay();
    };
    pill.append(span, btn);
    attachmentsEl.appendChild(pill);
  }
  updateContextDisplay();
}

function syncHistoryOnly() {
  const state = store.getState();
  renderChatHistory(chatHistoryList, state, {
    onSelect: (id) => {
      if (isGenerating) return;
      editingMessageId = null;
      store.setActive(id);
      lastMeasuredTokens = 0;
      syncUI();
    },
    onDelete: (id) => {
      if (isGenerating) return;
      store.deleteSession(id);
      editingMessageId = null;
      lastMeasuredTokens = 0;
      syncUI();
    },
    onRename: (id, title) => {
      store.renameSession(id, title);
      syncUI();
    },
    onNew: () => newChat(),
    disabled: isGenerating,
  });
  renderExportMenuUI();
  refreshModelDependentUI();
}

function renderExportMenuUI() {
  if (!exportMenuMount) return;
  renderExportMenu(
    exportMenuMount,
    { disabled: isGenerating || !activeMessages().length, busy: exportBusy },
    { onExport: handleExport }
  );
}

async function handleExport(format) {
  const session = store.getActiveSession();
  if (!session || !session.messages.length) return;
  if (format === "txt") {
    downloadTxt(session);
    return;
  }
  exportBusy = true;
  renderExportMenuUI();
  try {
    await downloadServerExport(session, format);
  } catch (err) {
    await showAlert(err.message || "Could not export chat.", { title: "Export failed" });
  } finally {
    exportBusy = false;
    renderExportMenuUI();
  }
}

async function runGeneration({ images = [], doc = null, branchFromEdit = false } = {}) {
  const modelInfo = getSelectedModelInfo();
  const model = getSelectedName() || modelSelect.value;
  if (!model) {
    await showAlert("Select a model first.");
    return;
  }
  const caps = modelCapabilities(modelInfo);

  const session = store.getActiveSession();
  if (!session) return;

  const sharedCoords = getSharedCoords();
  if (sharedCoords) caps.weather = true;

  const apiMessages = store.toApiPayload(session.messages);
  if (!apiMessages.length) return;

  isGenerating = true;
  updateSendState();
  syncHistoryOnly();

  const { shell, row } = appendAssistantShell(messagesEl, model);
  const progress = createGenerationProgress(caps, GEN_STEPS);
  if (genProgressToast) {
    genProgressToast.replaceChildren(progress.root);
  } else {
    shell.appendChild(progress.root);
  }
  const streamMount = document.createElement("div");
  streamMount.className = "stream-mount";
  shell.appendChild(streamMount);
  const stream = createStreamRenderer(streamMount, {
    onScroll: () => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },
    onMetrics: (m) => {
      const phase =
        m.contentChars > 0
          ? "generating"
          : m.thinkingChars > 0
            ? "thinking"
            : "loading";
      progress.updateLiveTokens({
        phase,
        thinkingTokens: m.thinkingTokens,
        contentTokens: m.contentTokens,
      });
    },
  });
  stream.showWaiting();
  progress.updateLiveTokens({ phase: "loading" });

  const formData = new FormData();
  formData.append("model", model);
  formData.append("messages", JSON.stringify(apiMessages));
  formData.append("stream", "true");
  formData.append("num_ctx", String(selectedNumCtx));
  updateGenFromControls();
  appendGenOptionsToForm(formData);
  // Always request thinking; backend retries without it if unsupported.
  formData.append("think", "true");
  images.forEach((img) => formData.append("images", img));
  if (doc) formData.append("document", doc);
  if (caps.webSearch) {
    formData.append("web_search_enabled", "true");
  }
  if (sharedCoords) {
    formData.append("lat", String(sharedCoords.lat));
    formData.append("lon", String(sharedCoords.lon));
    if (typeof sharedCoords.elev === "number" && Number.isFinite(sharedCoords.elev)) {
      formData.append("elevation", String(sharedCoords.elev));
    }
  }

  let fullReply = "";
  let fullThinking = "";
  let gotFirstToken = false;
  let inThinking = false;
  let streamDone = false;
  let finalStats = null;
  let pendingSearchSources = null;

  try {
    progress.setStage("send", "Sending to Ollama…");
    progress.updateLiveTokens({ phase: "loading" });
    const res = await fetch("/api/chat", { method: "POST", body: formData });
    if (!res.ok) {
      let detail = await res.text();
      try {
        const j = JSON.parse(detail);
        detail = j.detail || detail;
      } catch {
        /* keep text */
      }
      throw new Error(detail);
    }

    progress.setStage("load", "Loading model…");
    progress.updateLiveTokens({ phase: "loading" });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        let chunk;
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(chunk.error);

        if (chunk.type === "weather_start") {
          progress.setStage("weather", "Fetching weather…");
          continue;
        }
        if (chunk.type === "weather_done") {
          progress.setStage(
            caps.webSearch ? "search" : "load",
            chunk.ok ? "Weather ready…" : "Weather skipped…"
          );
          continue;
        }

        if (chunk.type === "search_start") {
          const label = chunk.search_type === "news" ? "Searching news…" : "Searching the web…";
          progress.setStage("search", label);
          continue;
        }
        if (chunk.type === "search_fetch") {
          progress.setStage("search", `Reading ${chunk.count ?? 3} pages…`);
          continue;
        }
        if (chunk.type === "search_done") {
          progress.setStage("load", "Search complete — loading model…");
          if (chunk.sources?.length) {
            pendingSearchSources = chunk.sources;
            const msgBody = row.querySelector(".message-body");
            if (msgBody) mountSourceChips(msgBody, pendingSearchSources);
          }
          continue;
        }

        const thinkingPiece = chunk.message?.thinking || "";
        if (thinkingPiece) {
          if (!inThinking) {
            inThinking = true;
            progress.setStage("thinking", "Thought process…");
          }
          if (!gotFirstToken) gotFirstToken = true;
          stream.appendThinking(thinkingPiece);
        }

        const piece = chunk.message?.content || "";
        if (piece) {
          if (inThinking) inThinking = false;
          if (!gotFirstToken) {
            gotFirstToken = true;
            progress.setStage("generate", "Generating…");
          }
          stream.append(piece);
          progress.setGeneratingProgress(stream.getText().length);
        } else if (!gotFirstToken && !thinkingPiece) {
          progress.setStage("prompt", "Processing prompt…");
        }

        if (chunk.done) {
          finalStats = {
            prompt_eval_count: chunk.prompt_eval_count,
            eval_count: chunk.eval_count,
            thinking_eval_count: chunk.thinking_eval_count,
            prompt_eval_duration: chunk.prompt_eval_duration,
            eval_duration: chunk.eval_duration,
            total_duration: chunk.total_duration,
            load_duration: chunk.load_duration,
          };
          streamDone = true;
          break;
        }
      }
    }

    const result = stream.finalize();
    fullReply = result.content;
    fullThinking = result.thinking;
    row.classList.remove("streaming-row");

    if (!fullReply) {
      /* finalize() already shows empty state */
    }

    if (finalStats?.prompt_eval_count != null || finalStats?.eval_count != null) {
      lastMeasuredTokens =
        (finalStats.prompt_eval_count || 0) + (finalStats.eval_count || 0);
    }

    progress.finish(finalStats);
    store.appendMessage(session.id, {
      role: "assistant",
      content: fullReply || "",
      modelName: model,
      thinking: fullThinking || "",
      ...(finalStats ? { stats: finalStats } : {}),
      ...(pendingSearchSources ? { sources: pendingSearchSources } : {}),
    });
  } catch (err) {
    row.classList.remove("streaming-row");
    fullReply = stream.getText();
    streamMount.replaceChildren();
    const errEl = document.createElement("p");
    errEl.className = "stream-error";
    errEl.textContent = `Error: ${err.message}`;
    streamMount.appendChild(errEl);
    progress.fail(err.message);
    if (!branchFromEdit) {
      const msgs = store.getActiveSession()?.messages ?? [];
      if (msgs.length && msgs[msgs.length - 1].role === "user") {
        store.replaceMessages(session.id, msgs.slice(0, -1));
      }
    }
  } finally {
    isGenerating = false;
    editingMessageId = null;
    if (genProgressToast) {
      setTimeout(() => genProgressToast.replaceChildren(), 4000);
    }
    updateSendState();
    syncUI();
    userInput.focus();
  }
}

async function loadModels({ prefer } = {}) {
  try {
    const res = await fetch("/api/models");
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const prevSelected = getSelectedName();
    modelSelect.innerHTML = "";
    if (!data.models?.length) {
      modelSelect.innerHTML = '<option value="">No models found</option>';
      setCatalog([]);
      lastModelFingerprint = "";
      onModelStateChanged();
      return;
    }
    const enriched = data.models.map((m) => ({
      name: m.name,
      digest: m.digest || "",
      modified_at: m.modified_at || "",
      context_length: m.context_length,
      capabilities: m.capabilities || [],
      labels: m.labels || [],
      support: m.support || {},
    }));
    const fp = catalogFingerprint(enriched);
    const listChanged = fp !== lastModelFingerprint;
    lastModelFingerprint = fp;
    setCatalog(enriched);
    enriched.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.name;
      opt.textContent = m.name;
      opt.title = formatModelTags(m.labels)
        ? `${m.name} — ${formatModelTags(m.labels)}`
        : m.name;
      modelSelect.appendChild(opt);
    });
    reconcileSelection(prefer || prevSelected || modelSelect.value);
    modelSelect.value = getSelectedName();
    onModelStateChanged();
    if (listChanged) {
      refreshModelDependentUI();
    }
  } catch {
    modelSelect.innerHTML = '<option value="">Ollama unavailable</option>';
    setCatalog([]);
    // Force next health poll to retry /api/models.
    lastModelFingerprint = "__error__";
    onModelStateChanged();
  }
}

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (data.ollama) {
      const count = data.models?.length || 0;
      statusBadge.textContent = `Ollama connected · ${count} model(s)`;
      statusBadge.className = "status ok";
      if (connectionText) connectionText.textContent = `Ollama · ${count} model${count === 1 ? "" : "s"}`;
      connectionDot?.classList.remove("err");
      // Identity fingerprint (name+digest+modified) so installs, upgrades,
      // and deleting the last model all refresh — including empty catalogs.
      const healthFp = catalogFingerprint(data.models || []);
      if (healthFp !== lastModelFingerprint) {
        await loadModels({ prefer: getSelectedName() });
      }
    } else {
      statusBadge.textContent = "Ollama not running";
      statusBadge.className = "status err";
      if (connectionText) connectionText.textContent = "Ollama offline";
      connectionDot?.classList.add("err");
    }
    updateWebSearchToggle(data.web_search);
  } catch {
    statusBadge.textContent = "Cannot reach server";
    statusBadge.className = "status err";
    if (connectionText) connectionText.textContent = "Server offline";
    connectionDot?.classList.add("err");
    updateWebSearchToggle(false);
  }
}

function updateWebSearchToggle(configured) {
  if (!webSearchToggle || !webSearchLabel) return;
  if (configured) {
    webSearchLabel.classList.remove("disabled");
    webSearchToggle.disabled = false;
    webSearchLabel.title = "Search the web via SerpAPI before answering";
  } else {
    webSearchToggle.checked = false;
    webSearchToggle.disabled = true;
    webSearchLabel.classList.add("disabled");
    webSearchLabel.title = "Add your SerpAPI key to serpapikey.env to enable web search";
  }
}

function newChat() {
  if (isGenerating) return;
  editingMessageId = null;
  lastMeasuredTokens = 0;
  riskBanner.classList.add("hidden");
  pendingImages = [];
  pendingDoc = null;
  renderAttachmentPills();
  userInput.value = "";
  userInput.style.height = "auto";
  clearInputSuggestion(userInput);
  store.createSession();
  syncUI();
  updateSendState();
}

userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = `${Math.min(userInput.scrollHeight, 200)}px`;
  if (userInput.value.trim()) userInput.classList.remove("suggesting");
  updateSendState();
  updateContextDisplay();
});

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) chatForm.requestSubmit();
  }
});

imageInput.addEventListener("change", async () => {
  if (!getSelectedModelInfo()?.support?.images) {
    await showAlert("Select a vision model for images.");
    imageInput.value = "";
    return;
  }
  pendingImages.push(...imageInput.files);
  imageInput.value = "";
  renderAttachmentPills();
  updateSendState();
});

docInput.addEventListener("change", () => {
  if (docInput.files[0]) {
    pendingDoc = docInput.files[0];
    docInput.value = "";
    renderAttachmentPills();
    updateSendState();
  }
});

newChatBtn.addEventListener("click", newChat);
ctxSlider.addEventListener("input", () => setNumCtx(parseInt(ctxSlider.value, 10)));
tempSlider.addEventListener("input", () => updateGenFromControls());
topPSlider.addEventListener("input", () => updateGenFromControls());
topKSlider.addEventListener("input", () => updateGenFromControls());
maxTokensSlider.addEventListener("input", () => updateGenFromControls());
repeatPenaltySlider.addEventListener("input", () => updateGenFromControls());
genPresetsEl.querySelectorAll("[data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => applyGenPreset(btn.dataset.preset));
});
modelSelect.addEventListener("change", () => {
  setSelectedName(modelSelect.value);
  persistSelectedName();
  applyModelContextSettings({ skipSelect: true });
  onModelStateChanged();
});

webSearchToggle?.addEventListener("change", () => refreshModelDependentUI());

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isGenerating) return;
  const model = modelSelect.value;
  if (!model) {
    await showAlert("Select a model first.");
    return;
  }

  const text = userInput.value.trim();
  const images = [...pendingImages];
  const doc = pendingDoc;
  if (!text && !images.length && !doc) return;

  if (images.length && !getSelectedModelInfo()?.support?.images) {
    await showAlert("Selected model cannot read images.");
    return;
  }

  let session = store.getActiveSession();
  if (!session) session = store.createSession();

  const attachmentMeta = {};
  if (images.length) {
    attachmentMeta.images = await Promise.all(images.map((f) => fileToDataUrl(f)));
  }
  if (doc) {
    attachmentMeta.docName = doc.name;
  }

  store.appendMessage(session.id, {
    role: "user",
    content: text,
    ...(Object.keys(attachmentMeta).length ? { attachments: attachmentMeta } : {}),
  });
  userInput.value = "";
  userInput.style.height = "auto";
  clearInputSuggestion(userInput);
  const savedImages = images;
  const savedDoc = doc;
  pendingImages = [];
  pendingDoc = null;
  renderAttachmentPills();
  syncUI();
  await runGeneration({ images: savedImages, doc: savedDoc });
});

store.ensureActive();
initSidebarAccordions();
initShareLocation();

bindCommandPalette(() => {
  const state = store.getState();
  const cmds = [
    { id: "new", label: "New chat", group: "Chat", run: () => newChat() },
    {
      id: "focus-input",
      label: "Focus message input",
      group: "Chat",
      run: () => userInput.focus(),
    },
  ];
  if (webSearchToggle && !webSearchToggle.disabled) {
    cmds.push({
      id: "toggle-web",
      label: webSearchToggle.checked ? "Disable web search" : "Enable web search",
      group: "Tools",
      run: () => {
        webSearchToggle.checked = !webSearchToggle.checked;
        refreshModelDependentUI();
      },
    });
  }
  CTX_PRESETS.filter((p) => p <= (getSelectedName() ? getModelMaxCtx(getSelectedName()) : 262144))
    .slice(0, 5)
    .forEach((preset) => {
      cmds.push({
        id: `ctx-${preset}`,
        label: `Set context to ${formatCtx(preset)}`,
        group: "Context",
        run: () => setNumCtx(preset),
      });
    });
  getCatalog();
  Object.keys(getCatalog()).forEach((name) => {
    cmds.push({
      id: `model-${name}`,
      label: `Switch to ${name}`,
      group: "Model",
      run: () => {
        setSelectedName(name);
        persistSelectedName();
        modelSelect.value = name;
        applyModelContextSettings({ skipSelect: true });
        onModelStateChanged();
      },
    });
  });
  state.sessions.forEach((s) => {
    cmds.push({
      id: `session-${s.id}`,
      label: s.title,
      group: "Sessions",
      run: () => {
        if (!isGenerating) {
          editingMessageId = null;
          store.setActive(s.id);
          lastMeasuredTokens = 0;
          syncUI();
        }
      },
    });
  });
  return cmds;
});

subscribeModels((evt) => {
  if (evt.type === "init") return;
  onModelStateChanged();
});
syncUI();
(async () => {
  await loadModels();
  await checkHealth();
  setInterval(checkHealth, 12000);
  updateSendState();
  updateAttachmentButtons();
})();

sessionTitleEl?.addEventListener("click", async () => {
  if (isGenerating) return;
  const session = store.getActiveSession();
  if (!session) return;
  const next = await showPrompt("Rename this chat", session.title, { title: "Rename chat" });
  if (next != null && next.trim()) {
    store.renameSession(session.id, next.trim());
    syncUI();
  }
});

document.getElementById("powerOffBtn")?.addEventListener("click", async () => {
  const ok = await showConfirm("Shut down server and release GPU memory?", {
    title: "Power Off",
    confirmLabel: "Shut down",
    danger: true,
  });
  if (!ok) return;
  const btn = document.getElementById("powerOffBtn");
  if (btn) btn.disabled = true;
  try {
    const r = await fetch("/api/shutdown", { method: "POST" });
    if (r.ok) {
      window.close();
      window.open("", "_self")?.close();
      location.replace("about:blank");
    } else if (btn) btn.disabled = false;
  } catch {
    if (btn) btn.disabled = false;
  }
});
/**
 * Real-time streaming renderer — thinking trace + answer with typewriter cursor.
 * Thought process panel is always present; empty traces show an explicit status.
 */
import {
  renderMarkdown,
  enhanceMessageContent,
} from "./markdown.js";

const RENDER_INTERVAL_MS = 72;
export const THINKING_UNAVAILABLE =
  "This model did not expose thinking";

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

/**
 * @param {HTMLElement} mountEl
 * @param {{onScroll?:()=>void,onMetrics?:(m:{thinkingChars:number,contentChars:number,thinkingTokens:number,contentTokens:number})=>void}} [opts]
 */
export function createStreamRenderer(mountEl, opts = {}) {
  let thinkingText = "";
  let contentText = "";
  let started = false;
  let finalized = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let throttleTimer = null;
  /** @type {HTMLElement | null} */
  let thinkingPanel = null;
  /** @type {HTMLElement | null} */
  let thinkingBody = null;
  /** @type {HTMLElement | null} */
  let thinkingMeta = null;
  /** @type {HTMLElement | null} */
  let contentWrap = null;
  /** @type {HTMLElement | null} */
  let waitingEl = null;

  function scroll() {
    opts.onScroll?.();
  }

  function emitMetrics() {
    opts.onMetrics?.({
      thinkingChars: thinkingText.length,
      contentChars: contentText.length,
      thinkingTokens: estimateTokens(thinkingText),
      contentTokens: estimateTokens(contentText),
    });
  }

  function showWaiting() {
    if (waitingEl || started) return;
    waitingEl = document.createElement("div");
    waitingEl.className = "typing-indicator";
    waitingEl.setAttribute("aria-label", "Waiting for model");
    waitingEl.innerHTML = "<span></span><span></span><span></span>";
    mountEl.appendChild(waitingEl);
    emitMetrics();
  }

  function ensureThinkingPanel() {
    if (thinkingPanel) return;
    started = true;
    waitingEl?.remove();
    waitingEl = null;
    thinkingPanel = document.createElement("details");
    thinkingPanel.className = "thinking-panel streaming";
    thinkingPanel.open = true;
    const summary = document.createElement("summary");
    summary.className = "thinking-summary";
    summary.innerHTML = `<span class="thinking-label">Thought process</span><span class="thinking-meta">live</span>`;
    thinkingMeta = summary.querySelector(".thinking-meta");
    thinkingBody = document.createElement("div");
    thinkingBody.className = "thinking-body";
    thinkingPanel.append(summary, thinkingBody);
    mountEl.appendChild(thinkingPanel);
    emitMetrics();
  }

  function beginContent() {
    if (contentWrap) return;
    // Keep Thought process visible above the answer from the first token.
    ensureThinkingPanel();
    started = true;
    waitingEl?.remove();
    waitingEl = null;
    contentWrap = document.createElement("div");
    contentWrap.className = "stream-reply streaming";
    mountEl.appendChild(contentWrap);
  }

  function paintThinking() {
    if (!thinkingBody || finalized) return;
    thinkingBody.textContent = thinkingText;
    if (thinkingMeta) {
      const tok = estimateTokens(thinkingText);
      thinkingMeta.textContent = `${tok} tok · live`;
    }
    scroll();
    emitMetrics();
  }

  function paintContent() {
    if (!contentWrap || finalized) return;
    contentWrap.replaceChildren();
    const textNode = document.createTextNode(contentText);
    contentWrap.appendChild(textNode);
    const cursor = document.createElement("span");
    cursor.className = "stream-cursor";
    cursor.setAttribute("aria-hidden", "true");
    contentWrap.appendChild(cursor);
    scroll();
    emitMetrics();
  }

  function schedulePaint(kind) {
    clearTimeout(throttleTimer);
    if (kind === "thinking") paintThinking();
    else paintContent();
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      if (!finalized) {
        if (kind === "thinking") paintThinking();
        else paintContent();
      }
    }, RENDER_INTERVAL_MS);
  }

  function appendThinking(piece) {
    if (!piece || finalized) return;
    ensureThinkingPanel();
    thinkingText += piece;
    schedulePaint("thinking");
  }

  function append(piece) {
    if (!piece || finalized) return;
    beginContent();
    contentText += piece;
    schedulePaint("content");
  }

  function finalize() {
    if (finalized) {
      return { content: contentText, thinking: thinkingText };
    }
    finalized = true;
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    waitingEl?.remove();
    waitingEl = null;

    ensureThinkingPanel();
    if (!thinkingPanel) {
      return { content: contentText, thinking: thinkingText };
    }
    thinkingPanel.classList.remove("streaming");
    if (thinkingText) {
      if (thinkingMeta) {
        thinkingMeta.textContent = `${estimateTokens(thinkingText)} tok`;
      }
      if (thinkingBody) thinkingBody.textContent = thinkingText;
    } else {
      if (thinkingMeta) thinkingMeta.textContent = "";
      if (thinkingBody) {
        thinkingBody.textContent = THINKING_UNAVAILABLE;
        thinkingBody.classList.add("thinking-unavailable");
      }
    }
    // Match legacy UX: open while live, collapse when the answer is ready.
    thinkingPanel.open = false;

    if (!contentText) {
      if (!contentWrap) {
        contentWrap = document.createElement("div");
        contentWrap.className = "stream-reply";
        mountEl.appendChild(contentWrap);
      }
      contentWrap.innerHTML = "<p><em>No response received.</em></p>";
      contentWrap.classList.remove("streaming");
      emitMetrics();
      return { content: contentText, thinking: thinkingText };
    }

    if (!contentWrap) beginContent();
    contentWrap.classList.remove("streaming");
    contentWrap.innerHTML = renderMarkdown(contentText);
    enhanceMessageContent(contentWrap);
    scroll();
    emitMetrics();
    return { content: contentText, thinking: thinkingText };
  }

  return {
    showWaiting,
    appendThinking,
    append,
    finalize,
    getText: () => contentText,
    getThinking: () => thinkingText,
    isStarted: () => started,
  };
}

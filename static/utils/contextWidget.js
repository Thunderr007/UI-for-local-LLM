import {
  buildChatContextInput,
  computeContextSnapshot,
} from "./contextCalc.js";
import { renderContextMonitor } from "../components/ContextMonitor.js";

/** @type {HTMLElement | null} */
let mount = null;

/** @param {HTMLElement} el */
export function initContextWidget(el) {
  mount = el;
}

/**
 * @param {{ modelName: string, maxTokens: number, messageTokens: number }} opts
 */
export function refreshContextWidget(opts) {
  if (!mount) return;
  const input = buildChatContextInput(opts);
  renderContextMonitor(mount, computeContextSnapshot(input));
}

/** Demo payload — run in DevTools: ContextWidget.demo() */
export function demo() {
  if (!mount) {
    mount = document.getElementById("contextMonitor");
  }
  if (!mount) return;
  renderContextMonitor(
    mount,
    computeContextSnapshot({
      modelName: "qwen3.5:9b",
      maxTokens: 32768,
      categories: {
        systemPrompt: 512,
        systemTools: 256,
        customAgents: 0,
        skills: 128,
        messages: 14200,
        autocompactBuffer: 1638,
      },
    })
  );
}

window.ContextWidget = { initContextWidget, refreshContextWidget, demo };

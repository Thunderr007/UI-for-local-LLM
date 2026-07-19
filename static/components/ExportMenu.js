/**
 * Floating export control — bottom-right FAB with an upward dropdown to
 * download the active chat as .txt, Word (.docx), or PDF.
 */

const FORMATS = [
  { id: "txt", label: "Download as .txt" },
  { id: "docx", label: "Download as Word (.docx)" },
  { id: "pdf", label: "Download as PDF" },
];

/**
 * @param {HTMLElement} root
 * @param {{disabled?: boolean, busy?: boolean}} state
 * @param {{onExport:(format:'txt'|'docx'|'pdf')=>void}} handlers
 */
export function renderExportMenu(root, state, handlers) {
  const disabled = state.disabled ?? false;
  const busy = state.busy ?? false;
  if (disabled) root.dataset.open = "0";
  const isOpen = root.dataset.open === "1";

  root.replaceChildren();

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "export-fab";
  trigger.title = disabled ? "No chat to export" : "Export chat";
  trigger.setAttribute("aria-label", "Export chat");
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
  trigger.disabled = disabled || busy;
  trigger.innerHTML = busy
    ? `<span class="export-fab-spinner" aria-hidden="true"></span>`
    : `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3v10.59l3.3-3.3 1.41 1.42L12 16.41l-4.71-4.7 1.41-1.42 3.3 3.3V3h2zM5 18h14v2H5v-2z"/></svg>`;
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (disabled || busy) return;
    root.dataset.open = isOpen ? "0" : "1";
    renderExportMenu(root, state, handlers);
  });

  const panel = document.createElement("div");
  panel.className = `export-menu-panel${isOpen ? " open" : ""}`;
  panel.setAttribute("role", "menu");

  FORMATS.forEach((fmt) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "export-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = fmt.label;
    item.addEventListener("click", () => {
      root.dataset.open = "0";
      renderExportMenu(root, state, handlers);
      handlers.onExport(fmt.id);
    });
    panel.appendChild(item);
  });

  root.append(panel, trigger);

  if (!root.dataset.boundClose) {
    root.dataset.boundClose = "1";
    document.addEventListener("click", (e) => {
      if (!root.contains(/** @type {Node} */ (e.target)) && root.dataset.open === "1") {
        root.dataset.open = "0";
        renderExportMenu(root, state, handlers);
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.dataset.open === "1") {
        root.dataset.open = "0";
        renderExportMenu(root, state, handlers);
      }
    });
  }
}

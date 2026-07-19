/**
 * Header dropdown — select, preview, and resume past chat threads.
 */
import { showConfirm } from "./Modal.js";

/**
 * @param {HTMLElement} root
 * @param {{sessions:import('../hooks/useChatSession.js').ChatSession[],activeSessionId:string|null}} data
 * @param {{onSelect:(id:string)=>void,onDelete:(id:string)=>void,onNew:()=>void,disabled?:boolean}} handlers
 */
export function renderHistoryDropdown(root, data, handlers) {
  const { sessions, activeSessionId } = data;
  const active = sessions.find((s) => s.id === activeSessionId);
  const isOpen = root.dataset.open === "1";
  const disabled = handlers.disabled ?? false;

  root.className = "history-dropdown";
  root.replaceChildren();

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "history-dropdown-trigger";
  trigger.disabled = disabled;
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
  trigger.innerHTML = `
    <span class="history-dropdown-label">${escapeHtml(active?.title || "Select chat")}</span>
    <svg class="history-dropdown-chevron${isOpen ? " open" : ""}" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M7 10l5 5 5-5H7z"/>
    </svg>`;
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (disabled) return;
    root.dataset.open = isOpen ? "0" : "1";
    renderHistoryDropdown(root, data, handlers);
    if (!isOpen) {
      const search = root.querySelector(".history-dropdown-search");
      search?.focus();
    }
  });

  const panel = document.createElement("div");
  panel.className = `history-dropdown-panel${isOpen ? " open" : ""}`;
  panel.setAttribute("role", "listbox");

  const searchWrap = document.createElement("div");
  searchWrap.className = "history-dropdown-search-wrap";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "history-dropdown-search";
  searchInput.placeholder = "Search chats…";
  searchInput.autocomplete = "off";
  searchWrap.appendChild(searchInput);
  panel.appendChild(searchWrap);

  const list = document.createElement("ul");
  list.className = "history-dropdown-list";

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const filter = (root.dataset.filter || "").toLowerCase();

  const filtered = filter
    ? sorted.filter(
        (s) =>
          s.title.toLowerCase().includes(filter) ||
          sessionPreview(s).toLowerCase().includes(filter)
      )
    : sorted;

  if (!filtered.length) {
    const empty = document.createElement("li");
    empty.className = "history-dropdown-empty";
    empty.textContent = sessions.length ? "No matching chats" : "No saved chats yet";
    list.appendChild(empty);
  } else {
    filtered.forEach((session) => {
      const li = document.createElement("li");
      li.className = "history-dropdown-item";
      if (session.id === activeSessionId) li.classList.add("active");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", session.id === activeSessionId ? "true" : "false");

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "history-dropdown-select";
      selectBtn.innerHTML = `
        <span class="history-dropdown-item-title">${escapeHtml(session.title)}</span>
        <span class="history-dropdown-item-meta">${session.messages.length} msg · ${formatRelativeTime(session.updatedAt)}</span>
        <span class="history-dropdown-item-preview">${escapeHtml(sessionPreview(session))}</span>`;
      selectBtn.addEventListener("click", () => {
        root.dataset.open = "0";
        root.dataset.filter = "";
        handlers.onSelect(session.id);
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "history-dropdown-delete";
      delBtn.title = "Delete chat";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await showConfirm(`Delete "${session.title}"?`, {
          title: "Delete chat",
          confirmLabel: "Delete",
          danger: true,
        });
        if (ok) handlers.onDelete(session.id);
      });

      li.append(selectBtn, delBtn);
      list.appendChild(li);
    });
  }

  panel.appendChild(list);

  searchInput.value = root.dataset.filter || "";
  searchInput.addEventListener("input", () => {
    root.dataset.filter = searchInput.value;
    renderHistoryDropdown(root, data, handlers);
    root.querySelector(".history-dropdown-search")?.focus();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      root.dataset.open = "0";
      renderHistoryDropdown(root, data, handlers);
    }
  });

  root.append(trigger, panel);

  if (isOpen && !root.dataset.boundClose) {
    root.dataset.boundClose = "1";
    document.addEventListener("click", (e) => {
      if (!root.contains(/** @type {Node} */ (e.target)) && root.dataset.open === "1") {
        root.dataset.open = "0";
        renderHistoryDropdown(root, data, handlers);
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.dataset.open === "1") {
        root.dataset.open = "0";
        renderHistoryDropdown(root, data, handlers);
      }
    });
  }
}

/** @param {import('../hooks/useChatSession.js').ChatSession} session */
function sessionPreview(session) {
  const last = [...session.messages].reverse().find((m) => m.content.trim());
  if (!last) return "Empty chat";
  const text = last.content.trim().replace(/\s+/g, " ");
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

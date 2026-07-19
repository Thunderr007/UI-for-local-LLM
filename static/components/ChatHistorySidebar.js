import { showPrompt, showConfirm } from "./Modal.js";

/**
 * Presentational chat history list.
 * @param {HTMLElement} root
 * @param {{sessions:import('../hooks/useChatSession.js').ChatSession[],activeSessionId:string|null}} data
 * @param {{onSelect:(id:string)=>void,onDelete:(id:string)=>void,onRename:(id:string,title:string)=>void}} handlers
 */
export function renderChatHistory(root, data, handlers) {
  const { sessions, activeSessionId } = data;
  root.replaceChildren();

  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No saved chats";
    root.appendChild(empty);
    return;
  }

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  sorted.forEach((session) => {
    const li = document.createElement("li");
    li.className = "history-item";
    if (session.id === activeSessionId) li.classList.add("active");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-select";
    btn.dataset.id = session.id;
    btn.title = session.title;
    btn.innerHTML = `<span class="history-title">${escapeHtml(session.title)}</span>
      <span class="history-meta">${session.messages.length} msg · ${formatRelativeTime(session.updatedAt)}</span>`;
    btn.addEventListener("click", () => handlers.onSelect(session.id));

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "history-icon";
    renameBtn.title = "Rename";
    renameBtn.textContent = "✎";
    renameBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const next = await showPrompt("Enter a new title for this chat", session.title, {
        title: "Rename chat",
      });
      if (next != null && next.trim()) handlers.onRename(session.id, next.trim());
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "history-icon danger";
    delBtn.title = "Delete";
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

    actions.append(renameBtn, delBtn);
    li.append(btn, actions);
    root.appendChild(li);
  });
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

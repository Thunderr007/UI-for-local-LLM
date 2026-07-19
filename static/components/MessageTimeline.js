/**
 * Presentational message timeline with inline edit and incremental DOM updates.
 */
import {
  renderMarkdown,
  escapeHtml,
  enhanceMessageContent,
} from "../utils/markdown.js";
import {
  applyExplainSuggestion,
  clearInputSuggestion,
} from "../utils/promptSuggestions.js";
import { getSelectedName, shortModelName } from "../utils/modelRuntime.js";

/**
 * @param {HTMLElement} root
 * @param {import('../hooks/useChatSession.js').Message[]} messages
 * @param {{onEdit?:(id:string,newContent:string|null,enterEdit?:boolean,cancel?:boolean)=>void,editingId?:string|null}} opts
 */
export function renderMessageTimeline(root, messages, opts) {
  const { onEdit, editingId } = opts;

  if (!messages.length) {
    root.querySelectorAll(".message-row").forEach((r) => r.remove());
    let welcome = root.querySelector(".welcome");
    if (!welcome) {
      welcome = buildWelcome();
      root.appendChild(welcome);
    } else {
      updateWelcomeModel(welcome);
    }
    return;
  }

  root.querySelector(".welcome")?.remove();

  const messageIds = new Set(messages.map((m) => m.id));
  root.querySelectorAll(".message-row").forEach((row) => {
    if (!messageIds.has(row.dataset.messageId)) row.remove();
  });

  messages.forEach((msg, index) => {
    const editing = msg.role === "user" && editingId === msg.id;
    let row = root.querySelector(`[data-message-id="${msg.id}"]`);
    const editState = row?.dataset.editingState === "1";

    if (!row || editState !== editing || row.dataset.role !== msg.role) {
      row?.remove();
      row = buildMessageRow(msg, { onEdit, editingId });
    } else if (msg.role === "assistant" && row) {
      const needsStats = msg.stats && !row.querySelector(".msg-stats");
      const needsThinking = !row.querySelector(".thinking-panel");
      const needsChips = msg.sources?.length && !row.querySelector(".source-chips");
      if (needsStats || needsThinking || needsChips) {
        row.remove();
        row = buildMessageRow(msg, { onEdit, editingId });
      } else {
        const contentEl = row.querySelector(".message-content");
        if (contentEl && !row.classList.contains("streaming-row")) {
          const currentHtml = contentEl.innerHTML;
          const nextHtml = renderMarkdown(msg.content);
          if (currentHtml !== nextHtml) {
            contentEl.innerHTML = nextHtml;
            enhanceMessageContent(contentEl);
          }
        }
      }
    } else if (msg.role === "user" && row && msg.attachments) {
      if (!row.querySelector(".message-attachments")) {
        row.remove();
        row = buildMessageRow(msg, { onEdit, editingId });
      }
    }

    const sibling = root.children[index];
    if (row && sibling !== row) {
      root.insertBefore(row, sibling || null);
    }
  });

  root.scrollTop = root.scrollHeight;
}

function buildWelcome() {
  const welcome = document.createElement("div");
  welcome.className = "welcome";
  welcome.id = "welcome";
  const model = getSelectedName() || "your model";
  welcome.innerHTML = `
    <h1>Ask your machine anything</h1>
    <p class="welcome-sub">Chat with text, images, and documents — fully local.</p>
    <p class="welcome-model">Running <strong>${escapeHtml(model)}</strong> locally</p>
    <div class="cards">
      <button type="button" class="card" data-action="suggest-explain">
        <span class="card-icon">💡</span>
        <span class="card-title">Explain a topic</span>
        <span class="card-desc">Get a clear breakdown of any concept</span>
      </button>
      <button type="button" class="card" data-prompt="Summarize the key points from the attached document.">
        <span class="card-icon">📄</span>
        <span class="card-title">Summarize a document</span>
        <span class="card-desc">Attach a PDF, TXT, or DOCX file</span>
      </button>
      <button type="button" class="card" data-prompt="What do you see in this image? Describe it in detail.">
        <span class="card-icon">🖼️</span>
        <span class="card-title">Analyze an image</span>
        <span class="card-desc">Use a vision model to describe photos</span>
      </button>
    </div>`;
  bindWelcomeCards(welcome);
  return welcome;
}

function updateWelcomeModel(welcome) {
  const modelEl = welcome.querySelector(".welcome-model strong");
  if (modelEl) modelEl.textContent = getSelectedName() || "your model";
}

function bindWelcomeCards(welcome) {
  welcome.querySelectorAll(".card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById("userInput");
      if (!input) return;
      if (btn.dataset.action === "suggest-explain") {
        applyExplainSuggestion(input);
        return;
      }
      const prompt = btn.dataset.prompt;
      if (!prompt) return;
      clearInputSuggestion(input);
      input.value = prompt;
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}

/**
 * @param {import('../hooks/useChatSession.js').Message} msg
 */
function buildMessageRow(msg, opts) {
  const { onEdit, editingId } = opts;
  const row = document.createElement("div");
  row.className = `message-row ${msg.role}`;
  row.dataset.messageId = msg.id;
  row.dataset.role = msg.role;
  row.dataset.editingState = msg.role === "user" && editingId === msg.id ? "1" : "0";

  const avatar = document.createElement("div");
  avatar.className = `avatar ${msg.role}`;
  if (msg.role === "user") {
    avatar.textContent = "You";
  } else {
    avatar.textContent = shortModelName(msg.modelName || getSelectedName());
    avatar.title = msg.modelName || getSelectedName() || "";
  }

  const body = document.createElement("div");
  body.className = "message-body";

  if (msg.role === "user" && editingId === msg.id) {
    body.appendChild(buildEditForm(msg, onEdit));
  } else {
    const toolbar =
      msg.role === "user" && onEdit ? buildUserToolbar(msg, onEdit) : null;
    if (toolbar) body.appendChild(toolbar);

    if (msg.attachments) {
      body.appendChild(buildAttachments(msg.attachments));
    }

    const contentEl = document.createElement("div");
    contentEl.className = "message-content";

    if (msg.role === "assistant") {
      if (msg.sources?.length) {
        body.appendChild(buildSourceChips(msg.sources));
      }
      // Always show Thought process for assistant turns (real trace or status).
      body.appendChild(buildThinkingPanel(msg.thinking || "", false));
      contentEl.innerHTML = renderMarkdown(msg.content);
      enhanceMessageContent(contentEl);
    } else {
      contentEl.innerHTML = `<p>${escapeHtml(msg.content).replace(/\n/g, "<br>")}</p>`;
    }

    body.appendChild(contentEl);

    if (msg.role === "assistant" && msg.stats) {
      body.appendChild(buildStatsFooter(msg.stats));
    }
  }

  row.append(avatar, body);
  return row;
}

/** @param {{images?:string[],docName?:string}} attachments */
function buildAttachments(attachments) {
  const wrap = document.createElement("div");
  wrap.className = "message-attachments";
  (attachments.images || []).forEach((src) => {
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = src;
    img.alt = "Attached image";
    wrap.appendChild(img);
  });
  if (attachments.docName) {
    const chip = document.createElement("span");
    chip.className = "doc-chip";
    chip.textContent = `📄 ${attachments.docName}`;
    wrap.appendChild(chip);
  }
  return wrap;
}

/**
 * Build a horizontal row of source chips for a web-searched message.
 * @param {Array<{index:number,title:string,url:string,domain?:string}>} sources
 * @returns {HTMLElement}
 */
function buildSourceChips(sources) {
  const wrap = document.createElement("div");
  wrap.className = "source-chips";
  sources.forEach((s) => {
    const a = document.createElement("a");
    a.className = "source-chip";
    a.href = s.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = s.title;
    a.innerHTML = `<span class="source-chip-index">[${s.index}]</span><span class="source-chip-domain">${escapeHtml(s.domain || s.url)}</span>`;
    wrap.appendChild(a);
  });
  return wrap;
}

/**
 * Inject source chips into an already-rendered message body (during streaming).
 * No-op if chips are already present.
 * @param {HTMLElement} messageBodyEl
 * @param {Array<{index:number,title:string,url:string,domain?:string}>} sources
 */
export function mountSourceChips(messageBodyEl, sources) {
  if (!sources?.length || messageBodyEl.querySelector(".source-chips")) return;
  const chips = buildSourceChips(sources);
  const contentEl = messageBodyEl.querySelector(".message-content");
  if (contentEl) {
    messageBodyEl.insertBefore(chips, contentEl);
  } else {
    messageBodyEl.prepend(chips);
  }
}

const THINKING_UNAVAILABLE = "This model did not expose thinking";

function buildThinkingPanel(thinking, isLive) {
  const panel = document.createElement("details");
  panel.className = `thinking-panel${isLive ? " streaming" : ""}`;
  panel.open = isLive;
  const hasTrace = Boolean(thinking && thinking.trim());
  const tok = hasTrace ? Math.ceil(thinking.length / 3.5) : 0;
  panel.innerHTML = `
    <summary class="thinking-summary">
      <span class="thinking-label">Thought process</span>
      <span class="thinking-meta">${
        hasTrace ? `${tok} tok${isLive ? " · live" : ""}` : ""
      }</span>
    </summary>`;
  const body = document.createElement("div");
  body.className = hasTrace ? "thinking-body" : "thinking-body thinking-unavailable";
  body.textContent = hasTrace ? thinking : THINKING_UNAVAILABLE;
  panel.appendChild(body);
  return panel;
}

/** @param {Record<string, unknown>} stats */
function buildStatsFooter(stats) {
  const el = document.createElement("div");
  el.className = "msg-stats";
  const parts = [];
  if (stats.prompt_eval_count != null) {
    parts.push(`Prompt: <strong>${stats.prompt_eval_count}</strong> tok`);
  }
  if (stats.eval_count != null) {
    parts.push(`Output: <strong>${stats.eval_count}</strong> tok`);
  }
  if (stats.thinking_eval_count != null) {
    parts.push(`Thinking: <strong>${stats.thinking_eval_count}</strong> tok`);
  }
  if (stats.eval_duration && stats.eval_count) {
    const tps = (
      Number(stats.eval_count) /
      (Number(stats.eval_duration) / 1e9)
    ).toFixed(1);
    parts.push(`<strong>${tps}</strong> tok/s`);
  }
  if (stats.total_duration) {
    parts.push(`Total: <strong>${(Number(stats.total_duration) / 1e9).toFixed(1)}s</strong>`);
  }
  el.innerHTML = parts.length ? parts.join(" · ") : "";
  return el;
}

function buildUserToolbar(msg, onEdit) {
  const bar = document.createElement("div");
  bar.className = "msg-toolbar";
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "msg-edit-btn";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => {
    onEdit(msg.id, null, true);
  });
  bar.appendChild(editBtn);
  return bar;
}

function buildEditForm(msg, onEdit) {
  const wrap = document.createElement("div");
  wrap.className = "msg-edit-form";
  const ta = document.createElement("textarea");
  ta.className = "msg-edit-input";
  ta.value = msg.content;
  ta.rows = 3;

  const actions = document.createElement("div");
  actions.className = "msg-edit-actions";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "msg-edit-save";
  save.textContent = "Save & branch";
  save.addEventListener("click", () => {
    const v = ta.value.trim();
    if (v) onEdit(msg.id, v, false);
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "msg-edit-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => onEdit(msg.id, null, false, true));

  actions.append(save, cancel);
  wrap.append(ta, actions);
  setTimeout(() => ta.focus(), 0);
  return wrap;
}

/** Append a streaming assistant shell; returns content mount node. */
export function appendAssistantShell(root, modelName) {
  root.querySelector(".welcome")?.remove();
  const row = document.createElement("div");
  row.className = "message-row assistant streaming-row";
  const avatar = document.createElement("div");
  avatar.className = "avatar assistant";
  const fullName = modelName || getSelectedName();
  avatar.textContent = shortModelName(fullName);
  avatar.title = fullName || "";
  const body = document.createElement("div");
  body.className = "message-body";
  const content = document.createElement("div");
  content.className = "message-content";
  body.appendChild(content);
  row.append(avatar, body);
  root.appendChild(row);
  root.scrollTop = root.scrollHeight;
  return { shell: content, row };
}

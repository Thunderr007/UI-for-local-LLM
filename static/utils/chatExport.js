/**
 * Chat export helpers — build a plain-text transcript of a session and
 * trigger .txt / .docx / .pdf downloads. Exported files stay plain
 * (default document formatting only); theming lives in the export UI, not
 * in the file contents.
 */

function slugify(title) {
  const slug = (title || "chat")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug || "chat").slice(0, 60);
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * @param {string} title
 * @param {string} ext
 */
export function exportFilename(title, ext) {
  return `${slugify(title)}-${dateStamp()}.${ext}`;
}

function roleLabel(msg) {
  if (msg.role === "user") return "You";
  if (msg.role === "assistant") return msg.modelName || "Assistant";
  return msg.role ? msg.role[0].toUpperCase() + msg.role.slice(1) : "Message";
}

function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSourceLine(src) {
  const prefix = src.index != null ? `[${src.index}] ` : "";
  const title = src.title || src.url || "Source";
  return src.url ? `${prefix}${title} — ${src.url}` : `${prefix}${title}`;
}

/**
 * Builds the shared plain-text transcript used for .txt export directly.
 * Kept fully literal (no markdown conversion) — every field a message can
 * carry (content, thinking, sources, attached document name) is included
 * so nothing is silently dropped.
 * @param {import('../hooks/useChatSession.js').ChatSession} session
 */
export function sessionToPlainText(session) {
  const title = session?.title || "Chat export";
  const lines = [title, ""];
  (session?.messages || []).forEach((msg) => {
    const ts = formatTimestamp(msg.timestamp);
    lines.push(ts ? `${roleLabel(msg)} — ${ts}` : roleLabel(msg));
    lines.push(msg.content || "");
    if (msg.thinking) {
      lines.push("", "Thinking:", msg.thinking);
    }
    if (msg.sources?.length) {
      lines.push("", "Sources:");
      msg.sources.forEach((src) => lines.push(formatSourceLine(src)));
    }
    if (msg.attachments?.docName) {
      lines.push("", `Attached: ${msg.attachments.docName}`);
    }
    lines.push("");
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * @param {import('../hooks/useChatSession.js').ChatSession} session
 */
export function downloadTxt(session) {
  const blob = new Blob([sessionToPlainText(session)], {
    type: "text/plain;charset=utf-8",
  });
  triggerDownload(blob, exportFilename(session?.title, "txt"));
}

function filenameFromContentDisposition(header, fallback) {
  if (!header) return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match ? match[1] : fallback;
}

/**
 * Sends the session to the server to build a .docx or .pdf, then downloads
 * the returned file.
 * @param {import('../hooks/useChatSession.js').ChatSession} session
 * @param {'docx'|'pdf'} format
 */
export async function downloadServerExport(session, format) {
  const payload = {
    format,
    title: session?.title || "Chat export",
    messages: (session?.messages || []).map((m) => ({
      role: m.role,
      content: m.content || "",
      timestamp: m.timestamp,
      modelName: m.modelName,
      thinking: m.thinking || null,
      sources: m.sources || null,
      docName: m.attachments?.docName || null,
    })),
  };

  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `Export failed (${res.status})`);
  }

  const blob = await res.blob();
  const filename = filenameFromContentDisposition(
    res.headers.get("Content-Disposition"),
    exportFilename(session?.title, format)
  );
  triggerDownload(blob, filename);
}

/**
 * Markdown rendering — GFM tables, fenced code blocks, highlight.js.
 * Depends on global `marked` and `hljs` (loaded via CDN in index.html).
 */

/** @type {import('marked').Marked | undefined} */
const markedApi = typeof marked !== "undefined" ? marked : undefined;

if (markedApi) {
  markedApi.setOptions({
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false,
  });

  markedApi.use({
    renderer: {
      code(src, infostring) {
        let code = typeof src === "object" && src !== null && "text" in src ? src.text : String(src);
        let lang =
          typeof src === "object" && src !== null && "lang" in src
            ? src.lang
            : (infostring || "").trim().split(/\s+/)[0];
        const language =
          lang && typeof hljs !== "undefined" && hljs.getLanguage(lang) ? lang : "plaintext";
        let highlighted = escapeHtml(code);
        if (typeof hljs !== "undefined") {
          try {
            highlighted =
              language === "plaintext"
                ? hljs.highlightAuto(code).value
                : hljs.highlight(code, { language }).value;
          } catch {
            highlighted = escapeHtml(code);
          }
        }
        const label = lang || "code";
        return `<div class="code-block-wrap">
          <div class="code-block-header">
            <span class="code-lang">${escapeHtml(label)}</span>
            <button type="button" class="code-copy-btn" data-code="${encodeAttr(code)}">Copy</button>
          </div>
          <pre><code class="hljs language-${escapeHtml(language)}" data-highlighted="1">${highlighted}</code></pre>
        </div>`;
      },
    },
  });
}

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function encodeAttr(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Close dangling markdown fences so partial streams render safely. */
export function prepareStreamMarkdown(text) {
  let safe = text || "";
  const fenceCount = (safe.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) safe += "\n```";
  return renderMarkdown(safe);
}

/** @param {string} text */
export function renderMarkdown(text) {
  if (!text) return "";
  try {
    if (!markedApi) return `<p>${escapeHtml(text)}</p>`;
    return markedApi.parse(text);
  } catch {
    return `<p>${escapeHtml(text)}</p>`;
  }
}

/** @param {HTMLElement} root */
export function enhanceMessageContent(root) {
  if (!root) return;
  root.querySelectorAll("pre code").forEach((block) => {
    if (typeof hljs !== "undefined" && !block.dataset.highlighted) {
      try {
        hljs.highlightElement(block);
        block.dataset.highlighted = "1";
      } catch {
        /* keep raw */
      }
    }
  });
  attachCodeCopyHandlers(root);
}

/** @param {HTMLElement} root */
export function attachCodeCopyHandlers(root) {
  root.querySelectorAll(".code-copy-btn").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const raw = btn.dataset.code || "";
      const decoded = raw
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&");
      try {
        await navigator.clipboard.writeText(decoded);
        const prev = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = prev;
        }, 1500);
      } catch {
        btn.textContent = "Failed";
      }
    });
  });
}

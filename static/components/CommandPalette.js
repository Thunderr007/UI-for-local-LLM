/**
 * Cmd+K command palette overlay.
 */

let paletteEl = null;
let activeItems = [];
let selectedIdx = 0;

function ensurePalette() {
  if (paletteEl) return paletteEl;
  paletteEl = document.createElement("div");
  paletteEl.className = "cmd-palette hidden";
  paletteEl.innerHTML = `
    <div class="cmd-palette-panel">
      <input type="search" class="cmd-palette-input" placeholder="Type a command…" autocomplete="off" />
      <ul class="cmd-palette-list" role="listbox"></ul>
    </div>`;
  document.body.appendChild(paletteEl);
  paletteEl.addEventListener("click", (e) => {
    if (e.target === paletteEl) closeCommandPalette();
  });
  return paletteEl;
}

export function closeCommandPalette() {
  if (!paletteEl) return;
  paletteEl.classList.add("hidden");
  const input = paletteEl.querySelector(".cmd-palette-input");
  if (input) input.value = "";
}

/**
 * @param {Array<{id:string,label:string,group?:string,run:()=>void}>} commands
 */
export function openCommandPalette(commands) {
  const el = ensurePalette();
  const input = el.querySelector(".cmd-palette-input");
  const list = el.querySelector(".cmd-palette-list");

  activeItems = commands;
  selectedIdx = 0;

  function render(filter = "") {
    const q = filter.toLowerCase();
    const filtered = activeItems.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.group || "").toLowerCase().includes(q)
    );
    list.replaceChildren();
    filtered.forEach((cmd, i) => {
      const li = document.createElement("li");
      li.className = `cmd-palette-item${i === selectedIdx ? " selected" : ""}`;
      li.setAttribute("role", "option");
      li.innerHTML = `
        <span class="cmd-palette-label">${escapeHtml(cmd.label)}</span>
        ${cmd.group ? `<span class="cmd-palette-group">${escapeHtml(cmd.group)}</span>` : ""}`;
      li.addEventListener("click", () => {
        closeCommandPalette();
        cmd.run();
      });
      list.appendChild(li);
    });
    selectedIdx = Math.min(selectedIdx, Math.max(0, filtered.length - 1));
    list.querySelectorAll(".cmd-palette-item").forEach((item, i) => {
      item.classList.toggle("selected", i === selectedIdx);
    });
    return filtered;
  }

  input.oninput = () => {
    selectedIdx = 0;
    render(input.value);
  };

  input.onkeydown = (e) => {
    const filtered = render(input.value);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1);
      render(input.value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      render(input.value);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selectedIdx];
      if (cmd) {
        closeCommandPalette();
        cmd.run();
      }
    } else if (e.key === "Escape") {
      closeCommandPalette();
    }
  };

  render("");
  el.classList.remove("hidden");
  input.focus();
}

export function bindCommandPalette(getCommands) {
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      if (paletteEl && !paletteEl.classList.contains("hidden")) {
        closeCommandPalette();
      } else {
        openCommandPalette(getCommands());
      }
    }
  });
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

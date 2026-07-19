/**
 * Glass modal dialogs — replaces native alert/confirm/prompt.
 */

let overlay = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "modal-overlay hidden";
  overlay.innerHTML = `
    <div class="modal-panel" role="dialog" aria-modal="true">
      <h2 class="modal-title"></h2>
      <p class="modal-message"></p>
      <input type="text" class="modal-input hidden" />
      <div class="modal-actions"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && overlay.dataset.dismissible === "1") {
      overlay.dispatchEvent(new CustomEvent("modal-cancel"));
    }
  });
  return overlay;
}

function closeModal() {
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.dataset.dismissible = "0";
}

/**
 * @param {string} message
 * @param {{ title?: string }} [opts]
 */
export function showAlert(message, opts = {}) {
  return new Promise((resolve) => {
    const el = ensureOverlay();
    const title = el.querySelector(".modal-title");
    const msg = el.querySelector(".modal-message");
    const input = el.querySelector(".modal-input");
    const actions = el.querySelector(".modal-actions");

    title.textContent = opts.title || "Notice";
    msg.textContent = message;
    input.classList.add("hidden");
    actions.replaceChildren();

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "modal-btn primary";
    ok.textContent = "OK";
    ok.addEventListener("click", () => {
      closeModal();
      resolve();
    });
    actions.appendChild(ok);

    el.dataset.dismissible = "0";
    el.classList.remove("hidden");
    ok.focus();
  });
}

/**
 * @param {string} message
 * @param {{ title?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} [opts]
 */
export function showConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    const el = ensureOverlay();
    const title = el.querySelector(".modal-title");
    const msg = el.querySelector(".modal-message");
    const input = el.querySelector(".modal-input");
    const actions = el.querySelector(".modal-actions");

    title.textContent = opts.title || "Confirm";
    msg.textContent = message;
    input.classList.add("hidden");
    actions.replaceChildren();

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "modal-btn";
    cancel.textContent = opts.cancelLabel || "Cancel";
    cancel.addEventListener("click", () => {
      closeModal();
      resolve(false);
    });

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = `modal-btn primary${opts.danger ? " danger" : ""}`;
    confirm.textContent = opts.confirmLabel || "Confirm";
    confirm.addEventListener("click", () => {
      closeModal();
      resolve(true);
    });

    actions.append(cancel, confirm);
    el.dataset.dismissible = "1";

    const onCancel = () => {
      el.removeEventListener("modal-cancel", onCancel);
      resolve(false);
    };
    el.addEventListener("modal-cancel", onCancel);

    el.classList.remove("hidden");
    confirm.focus();
  });
}

/**
 * @param {string} message
 * @param {string} [defaultValue]
 * @param {{ title?: string }} [opts]
 */
export function showPrompt(message, defaultValue = "", opts = {}) {
  return new Promise((resolve) => {
    const el = ensureOverlay();
    const title = el.querySelector(".modal-title");
    const msg = el.querySelector(".modal-message");
    const input = el.querySelector(".modal-input");
    const actions = el.querySelector(".modal-actions");

    title.textContent = opts.title || "Input";
    msg.textContent = message;
    input.classList.remove("hidden");
    input.value = defaultValue;
    actions.replaceChildren();

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "modal-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      closeModal();
      resolve(null);
    });

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "modal-btn primary";
    ok.textContent = "Save";
    const submit = () => {
      closeModal();
      resolve(input.value);
    };
    ok.addEventListener("click", submit);
    input.onkeydown = (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") cancel.click();
    };

    actions.append(cancel, ok);
    el.dataset.dismissible = "1";

    const onCancel = () => {
      el.removeEventListener("modal-cancel", onCancel);
      resolve(null);
    };
    el.addEventListener("modal-cancel", onCancel);

    el.classList.remove("hidden");
    input.focus();
    input.select();
  });
}

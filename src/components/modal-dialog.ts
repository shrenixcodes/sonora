/**
 * Styled <dialog> helpers replacing browser-native prompt() and alert() modals.
 */

import { el } from "@/lib/dom";

export interface PromptDialogOptions {
  title: string;
  subtitle?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  emptyError?: string;
  onConfirm: (value: string) => void;
}

export interface NoticeDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
}

function openDialog(dialog: HTMLDialogElement, initialFocus: HTMLElement): void {
  document.querySelector<HTMLDialogElement>(".sonora-dialog")?.close();
  const previouslyFocused = document.activeElement as HTMLElement | null;

  dialog.addEventListener("click", (e) => {
    const rect = dialog.getBoundingClientRect();
    const inside =
      rect.top <= e.clientY &&
      e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX &&
      e.clientX <= rect.left + rect.width;
    if (!inside) closeDialogElement(dialog);
  });

  dialog.addEventListener("close", () => {
    dialog.remove();
    previouslyFocused?.focus();
  });

  document.body.appendChild(dialog);
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
  initialFocus.focus();
}

function closeDialogElement(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  }
}

export function showPromptDialog(options: PromptDialogOptions): HTMLDialogElement {
  const errorEl = el("p", {
    className: "sonora-dialog__error",
    attrs: { role: "status", "aria-live": "polite", hidden: "" },
  });

  const input = el("input", {
    className: "sonora-dialog__input",
    attrs: {
      type: "text",
      ...(options.placeholder ? { placeholder: options.placeholder } : {}),
    },
  }) as HTMLInputElement;
  if (options.initialValue) input.value = options.initialValue;

  input.addEventListener("input", () => {
    errorEl.textContent = "";
    errorEl.setAttribute("hidden", "");
  });

  const cancelBtn = el("button", {
    className: "btn btn--secondary",
    text: "Cancel",
    attrs: { type: "button" },
    onClick: () => closeDialogElement(dialog),
  });

  const confirmBtn = el("button", {
    className: "btn btn--primary",
    text: options.confirmLabel ?? "Confirm",
    attrs: { type: "submit" },
  });

  const form = el("form", {
    className: "sonora-dialog__form",
    children: [
      input,
      errorEl,
      el("div", { className: "sonora-dialog__actions", children: [cancelBtn, confirmBtn] }),
    ],
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const trimmed = input.value.trim();
    if (!trimmed) {
      errorEl.textContent = options.emptyError ?? "Please enter a value.";
      errorEl.removeAttribute("hidden");
      input.focus();
      return;
    }
    closeDialogElement(dialog);
    options.onConfirm(trimmed);
  });

  const dialog = el("dialog", {
    className: "sonora-dialog",
    attrs: { "aria-labelledby": "sonora-dialog-title" },
    children: [
      el("h2", { className: "sonora-dialog__title", text: options.title, attrs: { id: "sonora-dialog-title" } }),
      ...(options.subtitle ? [el("p", { className: "sonora-dialog__subtitle", text: options.subtitle })] : []),
      form,
    ],
  }) as HTMLDialogElement;

  openDialog(dialog, input);
  return dialog;
}

export function showNoticeDialog(options: NoticeDialogOptions): HTMLDialogElement {
  const okBtn = el("button", {
    className: "btn btn--primary",
    text: options.confirmLabel ?? "OK",
    attrs: { type: "button" },
    onClick: () => closeDialogElement(dialog),
  });

  const dialog = el("dialog", {
    className: "sonora-dialog",
    attrs: { "aria-labelledby": "sonora-dialog-title" },
    children: [
      el("h2", { className: "sonora-dialog__title", text: options.title, attrs: { id: "sonora-dialog-title" } }),
      el("p", { className: "sonora-dialog__subtitle", text: options.message, attrs: { role: "alert" } }),
      el("div", { className: "sonora-dialog__actions", children: [okBtn] }),
    ],
  }) as HTMLDialogElement;

  openDialog(dialog, okBtn);
  return dialog;
}

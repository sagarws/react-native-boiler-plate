// @ts-nocheck

export const TOAST_EVENT = "veylix:toast";

export const DIALOG_CLOSE_EVENT = "veylix:dialog-close";

export function showToast(e) {
  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT, {
      detail: e,
    }),
  );
}

export function closeDialogs() {
  window.dispatchEvent(new Event(DIALOG_CLOSE_EVENT));
}

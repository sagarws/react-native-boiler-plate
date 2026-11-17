/** App-wide browser events (same idea as the template's `veylix:*` events). */
export const TOAST_EVENT = "trackvid:toast";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastDetail {
  id: number;
  message: string;
  tone: ToastTone;
}

let toastId = 0;

function emitToast(message: string, tone: ToastTone): void {
  if (typeof window === "undefined") return;
  toastId += 1;
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { id: toastId, message, tone } }));
}

/** Same call shape as `react-hot-toast` in TrackVid-FE: `toast.success("…")`, `toast.error("…")`. */
export const toast = Object.assign((message: string) => emitToast(message, "info"), {
  success: (message: string) => emitToast(message, "success"),
  error: (message: string) => emitToast(message, "error"),
  info: (message: string) => emitToast(message, "info"),
  warning: (message: string) => emitToast(message, "warning"),
});

/** Text of an unknown thrown value, for toasts and error states. */
export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

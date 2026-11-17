/**
 * The legacy response envelope, in legacy key order (`isSuccess, message, displayMessage, data`).
 * Key order matters: it changes the body bytes and the ETag.
 */
export interface Envelope<T = unknown> {
  isSuccess: boolean;
  message: string;
  displayMessage: string;
  data: T;
}

/** `{ isSuccess, message, displayMessage: message, data }` — the most common legacy shape. */
export const envelope = <T>(isSuccess: boolean, message: string, data: T = null as T, displayMessage = message): Envelope<T> => ({
  isSuccess,
  message,
  displayMessage,
  data,
});

export const ok = <T>(message: string, data: T = null as T, displayMessage = message) => envelope(true, message, data, displayMessage);
export const fail = <T = null>(message: string, data: T = null as T, displayMessage = message) => envelope(false, message, data, displayMessage);

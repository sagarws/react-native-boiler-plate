import DOMPurify from "dompurify";

/**
 * Sanitize untrusted HTML (email bodies, release notes, claim templates) before it is rendered.
 * Only call in the browser (client components); DOMPurify needs a DOM.
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|data:image\/|\/|#)/i,
  });
}

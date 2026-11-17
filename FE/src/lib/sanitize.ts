import DOMPurify from "dompurify";

/**
 * Sanitize untrusted HTML (email bodies, release notes, claim templates) before it is rendered.
 * Only call in the browser (client components); DOMPurify needs a DOM.
 */
let hooked = false;

export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return "";
  if (!hooked) {
    // Links in untrusted HTML always open in a new tab without access to this window.
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node instanceof HTMLAnchorElement && node.getAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
    hooked = true;
  }
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target"],
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|data:image\/|\/|#)/i,
  });
}

"use client";

import { sanitizeHtml } from "@/lib/sanitize";

/**
 * Email bodies come from outside (AJIO / customers) and are untrusted. TrackVid injected them raw;
 * here they always go through DOMPurify (`sanitizeHtml`: no scripts, handlers, forms, iframes or
 * `javascript:` links) before rendering. Links open in a new tab.
 */
export function EmailHtml({ html }: { html: string }) {
  const clean = sanitizeHtml(html).replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ');
  return <div className="tv-html tv-emails-html" dangerouslySetInnerHTML={{ __html: clean }} />;
}

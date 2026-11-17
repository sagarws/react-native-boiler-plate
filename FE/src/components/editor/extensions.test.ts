import { generateHTML, generateJSON } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { editorExtensions } from "@/components/editor/extensions";

/**
 * HTML round-trip gate (MIGRATION_PLAN §6.1). Samples follow the shape of the BE claim email
 * (`createClaimEmailHtml`) and of templates users edited and saved with Quill (ql-* classes).
 */
const BE_TEMPLATE = `<p>Dear Ajio Seller Support Team,</p><p><br></p><p>We are writing to raise a claim for the return shipment below.</p><ol><li><strong>AWB Number:</strong> 1490823311</li><li><strong>Order ID:</strong> FN4410293</li><li><strong>Claim type:</strong> Different product received</li></ol><p>The packing and return videos are available here: <a href="https://app.trackvid.in/base-link/abc/1490823311/1" rel="noopener noreferrer" target="_blank">View videos</a></p><p>Regards,<br>Urban Threads</p>`;

const QUILL_EDITED = `<h2 class="ql-align-center">Claim request</h2><p class="ql-align-right"><span class="ql-size-large">Urgent</span></p><p class="ql-indent-1">Indented note</p><p><span class="ql-font-serif">Serif text</span> and <span style="color: rgb(230, 0, 0);">red text</span> and <span style="background-color: rgb(255, 255, 0);">highlight</span></p><ul><li><u>underlined</u></li><li><s>struck</s></li></ul><blockquote>Quoted line</blockquote><p><a href="mailto:claims@urbanthreads.in">Email us</a></p>`;

const HOSTILE = `<p onclick="alert(1)">Hello</p><script>alert(2)</script><p><a href="javascript:alert(3)">bad link</a><img src=x onerror="alert(4)"></p>`;

const roundTrip = (html: string) => generateHTML(generateJSON(html, editorExtensions()), editorExtensions());
const text = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent ?? "").replace(/\s+/g, " ").trim();
};

describe("rich text editor HTML round trip", () => {
  it("keeps the text, list items and links of the BE claim template", () => {
    const out = roundTrip(BE_TEMPLATE);
    expect(text(out)).toBe(text(BE_TEMPLATE));
    expect(out).toContain('href="https://app.trackvid.in/base-link/abc/1490823311/1"');
    expect(out).toContain("<ol>");
    expect(out).toContain("<strong>AWB Number:</strong>");
  });

  it("reads Quill classes into inline styles (alignment, size, font, indent, colours)", () => {
    const out = roundTrip(QUILL_EDITED);
    expect(text(out)).toBe(text(QUILL_EDITED));
    expect(out).toMatch(/<h2[^>]*text-align: center/);
    expect(out).toMatch(/<p[^>]*text-align: right/);
    expect(out).toContain("font-size: 1.5em");
    expect(out).toMatch(/margin-left: 3em/);
    expect(out).toMatch(/font-family: Georgia/);
    expect(out).toMatch(/color: (rgb\(230, 0, 0\)|#e60000)/);
    expect(out).toMatch(/<mark[^>]*background-color/);
    expect(out).toContain("<u>underlined</u>");
    expect(out).toContain("<s>struck</s>");
    expect(out).toContain("<blockquote>");
    expect(out).toContain('href="mailto:claims@urbanthreads.in"');
  });

  it("is stable: saving twice gives the same HTML", () => {
    const once = roundTrip(QUILL_EDITED);
    expect(roundTrip(once)).toBe(once);
  });

  it("drops scripts, event handlers and javascript: links", () => {
    const out = roundTrip(HOSTILE);
    expect(out).not.toMatch(/script|onclick|onerror|javascript:/i);
    expect(text(out)).toContain("Hello");
  });
});

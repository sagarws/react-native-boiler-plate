// @ts-nocheck

export function htmlToPlainText(e) {
  return String(e || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitUniqueCommaList(e) {
  return [
    ...new Set(
      String(e || "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean),
    ),
  ];
}

export function slugifyProductHandle(e) {
  return String(e || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function sanitizeProductRichText(e) {
  if (typeof document > "u") return String(e || "");
  const t = document.createElement("template");
  t.innerHTML = String(e || "");
  const n = new Set([
    "P",
    "BR",
    "STRONG",
    "B",
    "EM",
    "I",
    "U",
    "UL",
    "OL",
    "LI",
    "H2",
    "H3",
    "BLOCKQUOTE",
    "A",
  ]);
  [...t.content.querySelectorAll("*")].forEach((e) => {
    if (!n.has(e.tagName)) e.replaceWith(...e.childNodes);
    else if (
      ([...e.attributes].forEach((t) => {
        if (e.tagName !== "A" || t.name !== "href") {
          e.removeAttribute(t.name);
        }
      }),
      e.tagName === "A")
    ) {
      const t = e.getAttribute("href") || "";
      if (/^(https?:\/\/|mailto:|\/)/i.test(t)) {
        e.setAttribute("target", "_blank");
        e.setAttribute("rel", "noopener noreferrer");
      } else {
        e.removeAttribute("href");
      }
    }
  });
  return t.innerHTML.trim();
}

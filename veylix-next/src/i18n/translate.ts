// @ts-nocheck
import { translationRows } from "@/i18n/dictionary";
import { locales } from "@/i18n/locales";
import { readStoredValue, writeStoredValue } from "@/lib/storage";

const translationsByLocale = Object.fromEntries(
  locales.map((e, t) => [
    e.id,
    Object.fromEntries(translationRows.map((e) => [e[0], e[t] || e[0]])),
  ]),
);

function normalizeLocale(e) {
  return locales.some((t) => t.id === e) ? e : "en";
}

let currentLocale = normalizeLocale(readStoredValue("locale", "en"));

export function getLocale() {
  return currentLocale;
}

function translate(e) {
  const t = e.trim();
  const n = translationsByLocale[currentLocale];
  let r = n[t];
  if (!r && currentLocale !== "en") {
    const e = t.match(/^Good (morning|afternoon|evening), (.+)$/);
    if (e) {
      r = `${
        {
          de: ["Guten Morgen", "Guten Tag", "Guten Abend"],
          fr: ["Bonjour", "Bon après-midi", "Bonsoir"],
          sv: ["God morgon", "God eftermiddag", "God kväll"],
          ar: ["صباح الخير", "مساء الخير", "مساء الخير"],
        }[currentLocale][["morning", "afternoon", "evening"].indexOf(e[1])]
      }, ${e[2]}`;
    }
    const i = t.match(/^Store health · (\d+)%$/);
    if (i) {
      r = `${n["Store health"]} · ${i[1]}%`;
    }
    const a = t.match(/^(\d+) products (dispatched|received)$/);
    if (a) {
      r = `${a[1]} ${
        {
          de: ["Produkte versendet", "Produkte erhalten"],
          fr: ["produits expédiés", "produits reçus"],
          sv: ["produkter skickade", "produkter mottagna"],
          ar: ["منتجات تم إرسالها", "منتجات تم استلامها"],
        }[currentLocale][a[2] === "dispatched" ? 0 : 1]
      }`;
    }
    const o = t.match(/^(.+) · (in stock|low stock)$/);
    if (o) {
      r = `${o[1]} · ${n[o[2] === "in stock" ? "In stock" : "Low stock"]}`;
    }
    const s = t.match(/^(\d+) units (available|left · time to restock)$/);
    if (s) {
      r = `${s[1]} ${
        {
          de: ["Einheiten verfügbar", "Einheiten übrig · nachbestellen"],
          fr: ["unités disponibles", "unités restantes · réapprovisionner"],
          sv: ["enheter tillgängliga", "enheter kvar · fyll på"],
          ar: ["وحدات متوفرة", "وحدات متبقية · أعد التوريد"],
        }[currentLocale][s[2] === "available" ? 0 : 1]
      }`;
    }
  }
  return r ? e.replace(t, r) : e;
}

export function setLocale(e) {
  currentLocale = normalizeLocale(e);
  writeStoredValue("locale", currentLocale);
  document.documentElement.lang = currentLocale;
  document.documentElement.dir = locales.find(
    (e) => e.id === currentLocale,
  ).dir;
  window.dispatchEvent(
    new CustomEvent("veylix:locale", {
      detail: currentLocale,
    }),
  );
}

export function translateDom(e) {
  const t = new WeakMap();
  let n = false;
  const r = () => {
    n = false;
    const r = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (; r.nextNode();) {
      const e = r.currentNode;
      if (
        !e.textContent.trim() ||
        e.parentElement?.closest(
          "script,style,textarea,[data-no-translate],[contenteditable]",
        )
      )
        continue;
      const n = t.get(e);
      const i = n && e.textContent === n.applied ? n.original : e.textContent;
      const a = translate(i);
      t.set(e, {
        original: i,
        applied: a,
      });
      if (e.textContent !== a) {
        e.textContent = a;
      }
    }
    for (const n of e.querySelectorAll("[placeholder],[aria-label]"))
      if (!n.closest("[data-no-translate]"))
        for (const e of ["placeholder", "aria-label"]) {
          const r = n.getAttribute(e);
          if (!r) continue;
          const i = t.get(n) || {};
          const a = i[e];
          const o = a && r === a.applied ? a.original : r;
          const s = translate(o);
          i[e] = {
            original: o,
            applied: s,
          };
          t.set(n, i);
          if (r !== s) {
            n.setAttribute(e, s);
          }
        }
  };
  const i = new MutationObserver(() => {
    if (!n) {
      n = true;
      queueMicrotask(r);
    }
  });
  i.observe(e, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.addEventListener("veylix:locale", r);
  setLocale(currentLocale);
  r();
  return () => {
    i.disconnect();
    window.removeEventListener("veylix:locale", r);
  };
}

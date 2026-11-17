// @ts-nocheck
import { brandAssets } from "@/config/branding";
import { settingsSections } from "@/config/modules/settings-sections";
import { readPreference } from "@/lib/store/preferences";

export function readGeneralSettings() {
  const e = settingsSections.general.defaults;
  const t = readPreference("settings-general", e);
  return {
    ...e,
    ...(t && typeof t == "object" ? t : {}),
  };
}

export function validateBrandImageDataUrl(e, t = "Image") {
  if (!e) return "";
  if (
    typeof e != "string" ||
    e.length > 85e4 ||
    !/^data:image\/(png|jpeg|webp|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/i.test(
      e,
    )
  )
    throw Error(`${t} must be a PNG, JPEG, WebP or ICO image up to 600 KB.`);
  return e;
}

export async function readBrandImageFile(e, t = "Image") {
  if (!e) return "";
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/x-icon",
      "image/vnd.microsoft.icon",
    ].includes(e.type) ||
    e.size <= 0 ||
    e.size > 614400
  )
    throw Error(`${t} must be a PNG, JPEG, WebP or ICO image up to 600 KB.`);
  const n = await new Promise((n, r) => {
    const i = new FileReader();
    i.onload = () => n(String(i.result || ""));
    i.onerror = () => r(Error(`${t} could not be read.`));
    i.readAsDataURL(e);
  });
  await new Promise((e, r) => {
    const i = new Image();
    i.onload = e;
    i.onerror = () => r(Error(`${t} is not a readable image.`));
    i.src = n;
  });
  return validateBrandImageDataUrl(n, t);
}

export function applyDocumentBranding(e) {
  if (typeof document > "u") return;
  const t = readGeneralSettings();
  const n = String(t.browserTitle || t.storeName || "Veylix").trim() || "Veylix";
  const r =
    e ||
    document
      .querySelector(".commerce-heading h1")
      ?.textContent?.replace(/\.\s*$/, "")
      .trim() ||
    document.title.split("|")[0]?.trim() ||
    "Overview";
  document.title = `${r} | ${n}`;
  let i = document.querySelector('link[rel~="icon"]');
  if (!i) {
    i = document.createElement("link");
    i.rel = "icon";
    document.head.append(i);
  }
  i.href = t.favicon || brandAssets.favicon;
}

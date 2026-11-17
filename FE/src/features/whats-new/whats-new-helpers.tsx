"use client";

import { Icon } from "@/components/icons/icon";
import { CMS_APP_DOWNLOAD_URL, CMS_APP_GUIDE_URL, CMS_APP_INSTALL_LINK_TEXT, WHATS_NEW_WALKTHROUGH_TEXT } from "@/config/app-constant";
import { sanitizeHtml } from "@/lib/sanitize";
import type { WhatsNewFeature, WhatsNewLanguage, WhatsNewStep, WhatsNewTranslation } from "@/types/whats-new";

export const languageOptions: { value: WhatsNewLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिंदी" },
  { value: "gu", label: "ગુજરાતી" },
];

export const isLanguage = (v: string): v is WhatsNewLanguage => v === "en" || v === "hi" || v === "gu";

/** TrackVid `localized`: English text, or the translation for the chosen language (falls back to English). */
export function localized(language: WhatsNewLanguage, en: string | undefined, tr?: WhatsNewTranslation): string {
  if (language === "en") return en || "";
  return tr?.[language] || en || "";
}

/** TrackVid `stripHtml` (result is only ever rendered as text). */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** TrackVid `shortDescription`: first step's text, 160 characters max. */
export function shortDescription(feature: WhatsNewFeature, language: WhatsNewLanguage): string {
  const firstStep = feature.images?.[0];
  if (!firstStep) return "";
  const text = stripHtml(localized(language, firstStep.description || "", firstStep.translations?.description));
  return text.length > 160 ? `${text.slice(0, 160).trimEnd()}…` : text;
}

export function featureLabel(feature: WhatsNewFeature, language: WhatsNewLanguage): string {
  return localized(language, feature.mainTitle || feature.title, feature.translations?.title);
}

/** `images` when present, else the single `image`. */
export function stepImages(step: WhatsNewStep): string[] {
  if (step.images && step.images.length > 0) return step.images;
  return step.image ? [step.image] : [];
}

/** First screenshot of a feature, used as the release card cover. */
export function coverImage(feature: WhatsNewFeature): string | null {
  for (const step of feature.images) {
    const imgs = stepImages(step);
    if (imgs.length) return imgs[0];
  }
  return null;
}

/**
 * Release-note HTML. TrackVid injected it raw; here it always goes through DOMPurify (`sanitizeHtml`) and links
 * open in a new tab (the source notes use `target="_blank"`, which the sanitizer drops).
 */
export function ReleaseHtml({ html }: { html: string }) {
  const clean = sanitizeHtml(html).replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ');
  return <div className="tv-html tv-whats-new-html" dangerouslySetInnerHTML={{ __html: clean }} />;
}

/** Guide + installer links for features with `cmsAppLinks` (TrackVid `renderCmsAppLinks`). */
export function CmsAppLinks() {
  return (
    <span className="tv-whats-new-links">
      <a href={CMS_APP_GUIDE_URL} target="_blank" rel="noopener noreferrer" className="text-link">
        {WHATS_NEW_WALKTHROUGH_TEXT} <Icon name="external-link" />
      </a>
      {/* No target: the server sends Content-Disposition: attachment. */}
      <a href={CMS_APP_DOWNLOAD_URL} download className="text-link">
        <Icon name="download" /> {CMS_APP_INSTALL_LINK_TEXT}
      </a>
    </span>
  );
}

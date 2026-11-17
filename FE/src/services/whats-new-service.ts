import { clone, delay } from "@/mocks/delay";
import { sampleWhatsNewFeatures } from "@/mocks/whats-new";
import type { WhatsNewEntry, WhatsNewFeature } from "@/types/whats-new";

/**
 * TrackVid-FE has no API for What's New: the release notes are a constant inside `pages/WhatsNew.tsx`.
 * This mock service serves that same list so the screen follows the "data comes from services" rule and
 * has real loading / error states.
 */

/** TrackVid `?feature=<slug>` rule: lower-case title, runs of whitespace → `-`. */
export function featureSlug(feature: Pick<WhatsNewFeature, "title">): string {
  return feature.title.toLowerCase().replace(/\s+/g, "-");
}

/**
 * TrackVid `dateForFeature`: a deterministic pseudo-random release date (3–183 days back) for entries
 * that carry no real date, so the grouped changelog order stays stable.
 */
function dateForFeature(feature: WhatsNewFeature, index: number): string {
  if (feature.date) return feature.date;
  const seedSrc = feature.mainTitle || feature.title || String(index);
  const seed = Array.from(seedSrc).reduce((a, c) => a + c.charCodeAt(0), 0);
  const daysBack = 3 + ((seed * 17 + index * 5) % 180);
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

/** All release notes, in source order, each with a release date and slug. */
const getFeatures = async (): Promise<WhatsNewEntry[]> => {
  await delay(300);
  return clone(sampleWhatsNewFeatures).map((feature, originalIndex) => ({
    feature: { ...feature, date: dateForFeature(feature, originalIndex) },
    originalIndex,
    slug: featureSlug(feature),
  }));
};

export const WhatsNewService = { getFeatures };

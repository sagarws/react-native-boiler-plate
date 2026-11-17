/** Types for /whats-new. Same field names as TrackVid-FE `pages/WhatsNew.tsx` (`FeatureStep`, `Feature`). */

export type WhatsNewLanguage = "en" | "hi" | "gu";

export interface WhatsNewTranslation {
  hi?: string;
  gu?: string;
}

export interface WhatsNewStep {
  title: string;
  /** HTML. Always rendered through `sanitizeHtml`. */
  description: string;
  image?: string;
  images?: string[];
  video?: string;
  translations?: {
    title?: WhatsNewTranslation;
    description?: WhatsNewTranslation;
  };
}

export interface WhatsNewFeature {
  mainTitle?: string;
  title: string;
  detailedDescription?: string;
  /** Release date (yyyy-MM-dd). The service fills it for entries that have none. */
  date?: string;
  images: WhatsNewStep[];
  /** "View walkthrough" opens the bundled CMS app guide in a new tab; an install link follows. */
  cmsAppLinks?: boolean;
  translations?: {
    title?: WhatsNewTranslation;
  };
}

/** A feature as returned by the service: `date` always set, `originalIndex` = position in the source list. */
export interface WhatsNewEntry {
  feature: WhatsNewFeature & { date: string };
  originalIndex: number;
  /** URL slug used by `?feature=<slug>` (TrackVid rule: lower-case title, whitespace → `-`). */
  slug: string;
}

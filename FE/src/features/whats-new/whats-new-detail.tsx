"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { FilterSelect } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { formatDate } from "@/lib/format";
import type { WhatsNewEntry, WhatsNewLanguage } from "@/types/whats-new";
import { ImageLightbox } from "./image-lightbox";
import { CmsAppLinks, featureLabel, isLanguage, languageOptions, localized, ReleaseHtml, stepImages } from "./whats-new-helpers";

/** TrackVid detail view: breadcrumb, title strip, step-by-step walkthrough with screenshots, Related News sidebar. */
export function WhatsNewDetail({
  entry,
  entries,
  language,
  onLanguageChange,
  onOpen,
  onBack,
}: {
  entry: WhatsNewEntry;
  entries: readonly WhatsNewEntry[];
  language: WhatsNewLanguage;
  onLanguageChange: (l: WhatsNewLanguage) => void;
  onOpen: (slug: string) => void;
  onBack: () => void;
}) {
  const { feature } = entry;
  const [lightbox, setLightbox] = useState<{ images: string[]; start: number; title: string } | null>(null);
  const titleText = localized(language, feature.title, feature.translations?.title);
  const mainTitleText = feature.mainTitle ? localized(language, feature.mainTitle, feature.translations?.title) : titleText;
  const related = entries.filter((e) => e.originalIndex !== entry.originalIndex).sort((a, b) => a.originalIndex - b.originalIndex);

  return (
    <div className="tv-page">
      <PageHeading
        title={mainTitleText}
        crumbs={[{ label: "News", href: "/whats-new" }]}
        subtitle={`Released ${formatDate(feature.date, "dd MMM yyyy")}`}
        actions={
          <button type="button" className="secondary-button" onClick={onBack}>
            <Icon name="arrow-left" /> All updates
          </button>
        }
      />

      <div className="tv-whats-new-detail">
        <article className="glass-card tv-whats-new-article">
          <header className="tv-whats-new-article-head">
            <h2>{titleText}</h2>
            <FilterSelect label="Language" value={language} onChange={(v) => isLanguage(v) && onLanguageChange(v)} options={languageOptions} />
          </header>

          {feature.cmsAppLinks ? (
            <div className="tv-whats-new-cms-links">
              <CmsAppLinks />
            </div>
          ) : null}

          <ol className="tv-whats-new-steps">
            {feature.images.map((step, idx) => {
              const stepTitle = localized(language, step.title, step.translations?.title);
              const stepDesc = localized(language, step.description, step.translations?.description);
              const imgs = stepImages(step);
              return (
                <li key={idx} className="tv-whats-new-step">
                  <h3>
                    <span className="tv-whats-new-step-no" aria-hidden="true">
                      {idx + 1}
                    </span>
                    {stepTitle}
                  </h3>
                  <ReleaseHtml html={stepDesc} />
                  {step.video ? <video className="tv-whats-new-video" src={step.video} controls preload="metadata" /> : null}
                  {imgs.length > 0 ? (
                    <div className={`tv-whats-new-shots ${imgs.length > 1 ? "is-multi" : ""}`.trim()}>
                      {imgs.map((img, ii) => (
                        <button
                          key={`${img}-${ii}`}
                          type="button"
                          className="tv-whats-new-shot"
                          onClick={() => setLightbox({ images: imgs, start: ii, title: stepTitle })}
                          aria-label={`View ${stepTitle} screenshot ${ii + 1} full screen`}
                        >
                          <img src={img} alt={`${stepTitle} ${ii + 1}`} loading="lazy" />
                          <span className="tv-whats-new-shot-zoom" aria-hidden="true">
                            <Icon name="arrows-out" />
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </article>

        <aside className="glass-card tv-whats-new-related" aria-label="Related News">
          <h2>Related News</h2>
          <ul>
            {related.map((e) => (
              <li key={e.originalIndex}>
                <button type="button" onClick={() => onOpen(e.slug)}>
                  <strong>{featureLabel(e.feature, language)}</strong>
                  <small>{formatDate(e.feature.date, "dd MMM yyyy")}</small>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {lightbox ? <ImageLightbox images={lightbox.images} start={lightbox.start} title={lightbox.title} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}

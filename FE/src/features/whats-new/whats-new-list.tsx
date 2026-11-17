"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { Banner } from "@/components/ui/banner";
import { ToneBadge } from "@/components/ui/card-primitives";
import { FilterSelect, SearchInput } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { EmptyState } from "@/components/ui/states";
import { WHATS_NEW_WALKTHROUGH_TEXT } from "@/config/app-constant";
import { formatDate } from "@/lib/format";
import type { WhatsNewEntry, WhatsNewLanguage } from "@/types/whats-new";
import { CmsAppLinks, coverImage, featureLabel, isLanguage, languageOptions, shortDescription } from "./whats-new-helpers";

/** TrackVid list view: release notes grouped by release date (newest first), each with a walkthrough link. */
export function WhatsNewList({
  entries,
  language,
  onLanguageChange,
  onOpen,
  unknownFeature,
  onClearFeature,
}: {
  entries: readonly WhatsNewEntry[];
  language: WhatsNewLanguage;
  onLanguageChange: (l: WhatsNewLanguage) => void;
  onOpen: (slug: string) => void;
  unknownFeature: string | null;
  onClearFeature: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = entries.filter(({ feature }) => {
    if (!q) return true;
    return `${featureLabel(feature, language)} ${feature.title} ${shortDescription(feature, language)}`.toLowerCase().includes(q);
  });

  const groups = new Map<string, WhatsNewEntry[]>();
  [...visible]
    .sort((a, b) => b.feature.date.localeCompare(a.feature.date))
    .forEach((e) => groups.set(e.feature.date, [...(groups.get(e.feature.date) ?? []), e]));
  const newest = entries.reduce((max, e) => (e.feature.date > max ? e.feature.date : max), "");

  return (
    <div className="tv-page">
      <PageHeading title="News" subtitle="Here, you will see recent updates/releases on TrackVid" />

      {unknownFeature ? (
        <Banner
          tone="warning"
          title="Update not found"
          actions={
            <button type="button" className="secondary-button compact-button" onClick={onClearFeature}>
              Show all updates
            </button>
          }
        >
          There is no release note called “{unknownFeature}”.
        </Banner>
      ) : null}

      <section className="glass-card tv-whats-new-intro">
        <div className="tv-whats-new-intro-copy">
          <span className="icon-tile tile-amber">
            <Icon name="megaphone" />
          </span>
          <p>
            We will post updates to this page as and when we have done the release or updates to TrackVid. Please visit this
            page often to check on the updates we have done to TrackVid.
          </p>
        </div>
        <div className="c-toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search updates" label="Search updates" />
          <FilterSelect label="Language" value={language} onChange={(v) => isLanguage(v) && onLanguageChange(v)} options={languageOptions} />
        </div>
      </section>

      {groups.size === 0 ? (
        <section className="glass-card">
          <EmptyState
            icon="megaphone"
            title={q ? "No updates match your search" : "No updates yet"}
            message={q ? "Try another word or clear the search." : "New releases will show up here."}
            action={
              q ? (
                <button type="button" className="secondary-button" onClick={() => setQuery("")}>
                  Clear search
                </button>
              ) : undefined
            }
          />
        </section>
      ) : (
        Array.from(groups.entries()).map(([date, items]) => (
          <section key={date} className="tv-whats-new-group" aria-label={`Released ${formatDate(date)}`}>
            <h2 className="tv-whats-new-date">
              <Icon name="calendar" /> {formatDate(date, "dd MMM yyyy")}
              {date === newest ? <ToneBadge label="Latest" tone="amber" /> : null}
            </h2>
            <div className="tv-whats-new-grid">
              {items.map(({ feature, slug, originalIndex }) => {
                const label = featureLabel(feature, language);
                const preview = shortDescription(feature, language);
                const cover = coverImage(feature);
                return (
                  <article key={originalIndex} className="glass-card tv-whats-new-card">
                    {feature.cmsAppLinks ? (
                      <div className="tv-whats-new-cover is-icon" aria-hidden="true">
                        <Icon name="monitor" />
                      </div>
                    ) : (
                      <button type="button" className="tv-whats-new-cover" onClick={() => onOpen(slug)} aria-label={`Open ${label}`}>
                        {cover ? <img src={cover} alt="" loading="lazy" /> : <Icon name="sparkle" />}
                      </button>
                    )}
                    <div className="tv-whats-new-card-body">
                      <h3>
                        {feature.cmsAppLinks ? (
                          label
                        ) : (
                          <button type="button" className="tv-whats-new-title-link" onClick={() => onOpen(slug)}>
                            {label}
                          </button>
                        )}
                      </h3>
                      {preview ? <p>{preview}</p> : null}
                      <div className="tv-whats-new-card-foot">
                        {feature.cmsAppLinks ? (
                          <CmsAppLinks />
                        ) : (
                          <span className="tv-whats-new-links">
                            <button type="button" className="text-link" onClick={() => onOpen(slug)}>
                              {WHATS_NEW_WALKTHROUGH_TEXT} <Icon name="arrow-right" />
                            </button>
                          </span>
                        )}
                        <small className="tv-muted">
                          {feature.images.length} {feature.images.length === 1 ? "step" : "steps"}
                        </small>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageHeading } from "@/components/ui/page-heading";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/lib/use-async";
import { WhatsNewService } from "@/services/whats-new-service";
import type { WhatsNewLanguage } from "@/types/whats-new";
import { WhatsNewDetail } from "./whats-new-detail";
import { WhatsNewList } from "./whats-new-list";

/**
 * /whats-new — TrackVid `pages/WhatsNew.tsx`: a dated changelog ("News") and a per-feature walkthrough with
 * step screenshots, a language switch (English / हिंदी / ગુજરાતી) and a "Related News" sidebar.
 * The open feature lives in `?feature=<slug>` (TrackVid's deep-link format), so links and Back work.
 */
export function WhatsNewPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const featureParam = (searchParams.get("feature") ?? "").toLowerCase();
  const [language, setLanguage] = useState<WhatsNewLanguage>("en");
  const { data, loading, error, reload } = useAsync(() => WhatsNewService.getFeatures(), []);

  const openDetail = (slug: string) => router.push(`${pathname}?feature=${encodeURIComponent(slug)}`);
  const closeDetail = () => router.push(pathname);

  if (loading || error || !data) {
    return (
      <div className="tv-page">
        <PageHeading title="News" subtitle="Here, you will see recent updates/releases on TrackVid" />
        <section className="glass-card">
          {loading ? <LoadingState label="Loading updates…" /> : <ErrorState message={error} onRetry={reload} title="Could not load updates" />}
        </section>
      </div>
    );
  }

  const active = featureParam ? data.find((e) => e.slug.toLowerCase() === featureParam) : undefined;
  if (active) {
    return (
      <WhatsNewDetail
        key={active.slug}
        entry={active}
        entries={data}
        language={language}
        onLanguageChange={setLanguage}
        onOpen={openDetail}
        onBack={closeDetail}
      />
    );
  }
  return <WhatsNewList entries={data} language={language} onLanguageChange={setLanguage} onOpen={openDetail} unknownFeature={featureParam ? featureParam : null} onClearFeature={closeDetail} />;
}

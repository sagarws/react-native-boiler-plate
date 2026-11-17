"use client";

import { useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { PageHeading } from "@/components/ui/page-heading";
import { EmptyState, Spinner } from "@/components/ui/states";
import { VideoPlayer } from "@/components/ui/video-player";
import { copyText } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { SAMPLE_QUERIES } from "@/mocks/video-link";
import { VideoLinkService } from "@/services/videoLink-service";
import type { VideoLinkResult } from "@/types/video-link";

const formatRecordedAt = (value: string) =>
  new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** TrackVid `VideoLink`: look up the shareable video link for an AWB or order number. */
export function VideoLinkPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<VideoLinkResult[] | null>(null);
  const [preview, setPreview] = useState<VideoLinkResult | null>(null);
  // Only the latest search may write results — a slower earlier response must not overwrite it.
  const requestSeq = useRef(0);

  const handleSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    const q = query.trim();
    if (!q) {
      toast.error("Please enter an AWB or order number.");
      return;
    }
    requestSeq.current += 1;
    const seq = requestSeq.current;
    setLoading(true);
    try {
      const rows = await VideoLinkService.search(q);
      if (seq !== requestSeq.current) return;
      setResults(rows);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setResults(null);
      toast.error(errorMessage(err, "Something went wrong. Please try again."));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  const handleCopy = async (url: string) => {
    if (await copyText(url)) toast.success("Link copied");
    else toast.error("Could not copy. Please copy the link manually.");
  };

  return (
    <div className="tv-page">
      <PageHeading title="Video Link" subtitle="Share the packing or return recording of an order." />
      <section className="glass-card tv-vlink-card" aria-labelledby="vlink-title">
        <h2 id="vlink-title" className="tv-section-title">
          Get Video Link
        </h2>
        <p className="tv-muted tv-small">Enter an AWB or order number to get the video link.</p>

        <form className="tv-vlink-form" onSubmit={(e) => void handleSearch(e)}>
          <label className="c-search tv-vlink-input">
            <Icon name="search" />
            <input
              name="videoLinkQuery"
              type="search"
              placeholder="AWB or order number"
              aria-label="AWB or order number"
              maxLength={100}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
          </label>
          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? <Spinner /> : <Icon name="link" />}
            Get Link
          </button>
        </form>
        <p className="tv-field-hint">Sample data: try {SAMPLE_QUERIES.join(", ")}.</p>

        {results && results.length === 0 ? <EmptyState icon="video-camera" title="No video found" message="Check the AWB or order number and try again." /> : null}

        {results && results.length > 0 ? (
          <ul className="tv-vlink-results" aria-live="polite">
            {results.map((item) => (
              <li key={item.videoLink} className="tv-vlink-item">
                <div className="tv-row">
                  <span className={`badge ${item.orderType.toLowerCase() === "return" ? "badge-amber" : "badge-blue"}`}>{item.orderType}</span>
                  <strong className="tv-small">AWB: {item.awbNumber}</strong>
                  {item.orderNo ? <span className="tv-small tv-muted">Order: {item.orderNo}</span> : null}
                  <small className="tv-muted tv-vlink-date">{formatRecordedAt(item.recordedAt)}</small>
                </div>
                <div className="tv-vlink-linkrow">
                  <a className="tv-link tv-ellipsis" href={item.videoLink} target="_blank" rel="noopener noreferrer">
                    {item.videoLink}
                  </a>
                  <button type="button" className="icon-button compact-button" aria-label="Play video" title="Play video" onClick={() => setPreview(item)}>
                    <Icon name="play" />
                  </button>
                  <button type="button" className="icon-button compact-button" aria-label="Copy link" title="Copy link" onClick={() => void handleCopy(item.videoLink)}>
                    <Icon name="copy" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {preview ? (
        <AppDialog
          title={`AWB ${preview.awbNumber} · ${preview.orderType}`}
          size="wide"
          onClose={() => setPreview(null)}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={() => void handleCopy(preview.videoLink)}>
                <Icon name="copy" /> Copy link
              </button>
              <button type="button" className="primary-button" onClick={() => setPreview(null)}>
                Close
              </button>
            </>
          }
        >
          <VideoPlayer src={preview.videoLink} title={`Recording for AWB ${preview.awbNumber}`} autoPlay downloadName={`${preview.awbNumber}.mp4`} />
        </AppDialog>
      ) : null}
    </div>
  );
}

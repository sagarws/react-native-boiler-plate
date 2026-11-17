"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { copyText, downloadBlob } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { useAsync } from "@/lib/use-async";
import { buildZip, fetchForZip, resolveFileUrl } from "@/features/vms/vms-utils";
import type { ScreenshotView } from "@/types/vms";

/** Prints the screenshots one per page so the browser can "Save as PDF" (TrackVid used jsPDF, which is not installed). */
function PrintScreenshots({ title, images, onDone }: { title: string; images: readonly string[]; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const root = typeof document === "undefined" ? null : document.body;

  useEffect(() => {
    let active = true;
    const previousTitle = document.title;
    const restore = () => {
      document.title = previousTitle;
      if (active) onDone();
    };
    const imgs = Array.from(ref.current?.querySelectorAll("img") ?? []);
    Promise.all(
      imgs.map((img) =>
        img.decode().catch(() => {
          // A screenshot that cannot decode still prints as an empty tile; never block the PDF on it.
        }),
      ),
    ).then(() => {
      if (!active) return;
      // The browser suggests the document title as the PDF file name.
      document.title = title;
      window.addEventListener("afterprint", restore, { once: true });
      window.print();
    });
    return () => {
      active = false;
      window.removeEventListener("afterprint", restore);
      document.title = previousTitle;
    };
  }, [title, onDone]);

  if (!root) return null;
  return createPortal(
    // Reuses the CMS print stylesheet (`.tv-cms-print`): it hides the app and prints only this container.
    <div ref={ref} className="tv-cms-print" aria-hidden="true">
      {images.map((src, i) => (
        <figure key={`${src}-${i}`}>
          <img src={src} alt="" />
          <figcaption>
            {title} · Screenshot {i + 1}
          </figcaption>
        </figure>
      ))}
    </div>,
    root,
  );
}

/** TrackVid `ScreenshotModal` + `Carousel`: AWB header, slider with thumbnails, Copy Link, Download all / PDF / ZIP. */
export function ScreenshotsDialog({ view, onClose }: { view: ScreenshotView; onClose: () => void }) {
  const { trackingId, screenshots } = view;
  const keys = screenshots.map((s) => s.url).join("|");
  const { data, loading, error, reload } = useAsync(() => Promise.all(screenshots.map((s) => resolveFileUrl(s.url))), [keys]);
  const images = data ?? [];
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<"" | "all" | "pdf" | "zip">("");
  const donePrinting = useCallback(() => setBusy(""), []);
  const current = Math.min(index, Math.max(0, images.length - 1));

  const copyAwb = async () => {
    if (await copyText(trackingId)) toast.success("Tracking number copied");
  };

  const copyLink = async () => {
    const shot = screenshots[current];
    if (!shot) return;
    try {
      const url = await resolveFileUrl(shot.url);
      const absolute = new URL(url, window.location.origin).toString();
      if (await copyText(absolute)) toast.success("Link copied to clipboard!");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const downloadAll = async () => {
    setBusy("all");
    try {
      for (let i = 0; i < screenshots.length; i += 1) {
        const file = await fetchForZip(`${trackingId}_${i}`, screenshots[i].url);
        downloadBlob(file.data, file.name);
      }
    } catch (err) {
      toast.error(errorMessage(err, "Error downloading the screenshot"));
    } finally {
      setBusy("");
    }
  };

  const downloadZip = async () => {
    setBusy("zip");
    try {
      const files = await Promise.all(screenshots.map((s, i) => fetchForZip(`${trackingId}/Screenshot ${i + 1}`, s.url)));
      downloadBlob(await buildZip(files), `${trackingId}.zip`);
    } catch (err) {
      toast.error(errorMessage(err, "Error downloading the ZIP file"));
    } finally {
      setBusy("");
    }
  };

  const go = (d: number) => setIndex(images.length ? (current + d + images.length) % images.length : 0);

  return (
    <AppDialog
      size="wide"
      onClose={onClose}
      title={
        <span className="tv-vms-dialog-title">
          <span className="tv-muted">AWB Number</span>
          <span className="tv-vms-awb">
            <span>{trackingId}</span>
            <button type="button" className="icon-button compact-button" aria-label="Copy AWB number" onClick={() => void copyAwb()}>
              <Icon name="copy" />
            </button>
          </span>
          {!loading && images.length ? (
            <span className="tv-vms-count">
              {images.length} {images.length === 1 ? "screenshot" : "screenshots"}
            </span>
          ) : null}
        </span>
      }
    >
      {loading ? (
        <LoadingState label="Loading screenshots…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !images.length ? (
        <EmptyState icon="image" title="No Images found!" />
      ) : (
        <div className="tv-stack">
          <div className="tv-carousel" role="group" aria-roledescription="carousel" aria-label={`Screenshots of ${trackingId}`}>
            <img src={images[current]} alt={`Screenshot ${current + 1} of ${trackingId}`} />
            {images.length > 1 ? (
              <>
                <button type="button" className="tv-carousel-nav prev" aria-label="Previous screenshot" onClick={() => go(-1)}>
                  <Icon name="caret-left" />
                </button>
                <button type="button" className="tv-carousel-nav next" aria-label="Next screenshot" onClick={() => go(1)}>
                  <Icon name="caret-right" />
                </button>
              </>
            ) : null}
          </div>
          {images.length > 1 ? (
            <ul className="tv-vms-thumbs">
              {images.map((src, i) => (
                <li key={`${src}-${i}`}>
                  <button type="button" aria-label={`Screenshot ${i + 1}`} aria-current={i === current} onClick={() => setIndex(i)}>
                    <img src={src} alt="" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="tv-vms-shot-actions">
            <button type="button" className="secondary-button compact-button" onClick={() => void copyLink()}>
              <Icon name="link" /> Copy Link
            </button>
            <button type="button" className="secondary-button compact-button" disabled={busy !== ""} onClick={() => void downloadAll()}>
              {busy === "all" ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="image" />}
              {busy === "all" ? "Downloading..." : "Download all"}
            </button>
            <button
              type="button"
              className="secondary-button compact-button"
              disabled={busy !== ""}
              onClick={() => {
                setBusy("pdf");
                toast.info("Choose “Save as PDF” in the print dialog.");
              }}
            >
              {busy === "pdf" ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="file-text" />}
              {busy === "pdf" ? "Downloading..." : "Download as PDF"}
            </button>
            <button type="button" className="primary-button compact-button" disabled={busy !== ""} onClick={() => void downloadZip()}>
              {busy === "zip" ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="folder" />}
              {busy === "zip" ? "Downloading..." : "Download as ZIP"}
            </button>
          </div>
        </div>
      )}
      {busy === "pdf" ? <PrintScreenshots title={trackingId} images={images} onDone={donePrinting} /> : null}
    </AppDialog>
  );
}

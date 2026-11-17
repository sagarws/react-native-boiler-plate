// @ts-nocheck
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { SummaryList } from "@/components/ui/summary-list";
import { modulesById } from "@/config/modules/registry";
import { MediaFileCard } from "@/features/media/components/media-file-card";
import {
  MediaFileDetailsDialog,
  MediaPreviewDialog,
} from "@/features/media/components/media-file-dialogs";
import {
  MEDIA_TRASH_FOLDER,
  mediaLibraryFilters,
  mediaReservedFolders,
} from "@/features/media/constants";
import { showToast } from "@/lib/events";
import {
  listMediaFiles,
  saveMediaFile,
  uploadMediaFiles,
} from "@/lib/media-storage";

function matchesMediaFilter(e, t) {
  return t === "Trash"
    ? e.trashed
    : e.trashed
      ? false
      : t === "All files"
        ? true
        : t === "Starred"
          ? e.starred
          : t === "Images"
            ? e.type.startsWith("image/")
            : t === "Documents"
              ? e.type.includes("pdf") || e.type.includes("text")
              : t === "Video & audio"
                ? /^(video|audio)/.test(e.type)
                : e.folder === t;
}

export function MediaLibraryPage({ moduleId }) {
  const t = modulesById[moduleId];
  const [n, r] = useState([]);
  const [i, a] = useState("All files");
  const [o, s] = useState("");
  const [c, u] = useState("");
  const [d, f] = useState(true);
  const [p, m] = useState(false);
  const [h, g] = useState("");
  const [_, v] = useState(null);
  const [y, b] = useState(null);
  const [x, S] = useState(() => new Map());
  const C = useRef(new Map());
  const w = async () => {
    f(true);
    try {
      r(await listMediaFiles());
      g("");
    } catch (e) {
      g(e instanceof Error ? e.message : "Unable to read the media library.");
    } finally {
      f(false);
    }
  };
  useEffect(() => {
    w();
  }, [moduleId]);
  useEffect(() => {
    const e = window.setTimeout(() => u(o), 250);
    return () => window.clearTimeout(e);
  }, [o]);
  useEffect(() => {
    const e = new Map();
    for (const t of n) {
      if (t.blob) {
        e.set(t.id, URL.createObjectURL(t.blob));
      }
    }
    for (const e of C.current.values()) URL.revokeObjectURL(e);
    C.current = e;
    S(e);
    return () => {
      for (const t of e.values()) URL.revokeObjectURL(t);
      if (C.current === e) {
        C.current = new Map();
      }
    };
  }, [n]);
  const T = useMemo(
    () => [...new Set(n.filter((e) => !e.trashed).map((e) => e.folder))],
    [n],
  );
  const E = useMemo(
    () => [...mediaLibraryFilters, ...T, MEDIA_TRASH_FOLDER],
    [T],
  );
  const D = useMemo(() => {
    const e = c.toLowerCase();
    return n
      .filter((e) => matchesMediaFilter(e, i))
      .filter((t) => t.name.toLowerCase().includes(e));
  }, [n, i, c]);
  const O = n.filter((e) => !e.trashed);
  const k = (_ && x.get(_.id)) || "";
  const A = async (e) => {
    const t = [...(e.target.files || [])];
    if (t.length) {
      m(true);
      g("");
      try {
        await uploadMediaFiles(t, mediaReservedFolders.has(i) ? "Uploads" : i);
        await w();
        showToast("Files saved to your local media library.");
        e.target.value = "";
      } catch (e) {
        const t = e instanceof Error ? e.message : "Files could not be uploaded.";
        g(t);
        showToast(t);
      } finally {
        m(false);
      }
    }
  };
  const j = async (e) => {
    try {
      await e();
      g("");
    } catch (e) {
      const t =
        e instanceof Error
          ? e.message
          : "This file change could not be completed.";
      g(t);
      showToast(t);
    }
  };
  const M = async (e) =>
    j(async () => {
      await saveMediaFile({
        ...e,
        starred: !e.starred,
      });
      await w();
    });
  const N = async (e) =>
    j(async () => {
      await saveMediaFile({
        ...e,
        trashed: !e.trashed,
      });
      await w();
    });
  return d && !n.length ? (
    <section className="glass-card c-empty" aria-live="polite">
      Loading workspace…
    </section>
  ) : (
    <Fragment>
      <CommercePageHeading
        title={t.title}
        actions={
          <label className="primary-button c-upload-button">
            <Icon name="plus" />
            {" Upload files"}
            <input
              type="file"
              multiple
              data-media-upload
              accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/*,application/pdf,text/plain"
              disabled={p}
              onChange={A}
            />
          </label>
        }
      />
      <SummaryList
        items={[
          ["Files", O.length, "Stored in this browser"],
          [
            "Storage used",
            `${(n.reduce((e, t) => e + t.size, 0) / 1024 / 1024).toFixed(2)} MB`,
            "Local IndexedDB",
          ],
          ["Folders", T.length, "Organize with the Edit action"],
        ]}
      />
      {h ? (
        <p className="c-form-error" role="alert">
          {h}
        </p>
      ) : null}
      <div className="c-media-layout">
        <nav className="glass-card c-media-nav" aria-label="Media filters">
          {E.map((e) => (
            <button
              key={e}
              type="button"
              data-c-action="media-filter"
              data-filter={e}
              className={i === e ? "active" : ""}
              onClick={() => a(e)}
            >
              <Icon name={e === "Trash" ? "basket" : "notebook"} />
              {e}
            </button>
          ))}
        </nav>
        <section className="glass-card">
          <div className="c-toolbar">
            <h2>{i}</h2>
            <label className="c-search">
              <Icon name="search" />
              <input
                type="search"
                data-media-search
                value={o}
                placeholder="Search files"
                aria-label="Search files"
                onChange={(e) => s(e.currentTarget.value)}
              />
            </label>
          </div>
          {d ? (
            <div className="c-empty" aria-live="polite">
              <Icon name="basket" />
              <h3>Loading workspace…</h3>
            </div>
          ) : D.length ? (
            <div
              className={moduleId === "files" ? "c-file-list" : "c-media-grid"}
            >
              {D.map((e) => (
                <MediaFileCard
                  key={e.id}
                  file={e}
                  previewUrl={x.get(e.id)}
                  onPreview={v}
                  onStar={(e) => {
                    M(e);
                  }}
                  onEdit={b}
                  onTrash={(e) => {
                    N(e);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="c-empty">
              <Icon name="basket" />
              <h3>A place for your files</h3>
              <p>
                Upload product photos, videos, audio notes or documents. Files
                stay in this browser, including after a reload.
              </p>
            </div>
          )}
        </section>
      </div>
      {_ && k ? (
        <MediaPreviewDialog file={_} url={k} onClose={() => v(null)} />
      ) : null}
      {y ? (
        <MediaFileDetailsDialog
          file={y}
          onClose={() => b(null)}
          onSave={async (e) => {
            if (y) {
              await saveMediaFile({
                ...y,
                ...e,
              });
              b(null);
              await w();
              showToast("File details updated.");
            }
          }}
        />
      ) : null}
    </Fragment>
  );
}

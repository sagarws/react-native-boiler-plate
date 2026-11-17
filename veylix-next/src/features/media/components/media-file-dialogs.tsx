// @ts-nocheck
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";

export function MediaPreviewDialog({ file, url, onClose }) {
  const r = file.type.startsWith("image/") ? (
    <img src={url} alt={file.name} />
  ) : file.type.startsWith("video/") ? (
    <video controls src={url} />
  ) : file.type.startsWith("audio/") ? (
    <audio controls src={url} />
  ) : (
    <p>Download this document to view it in your preferred application.</p>
  );
  return (
    <AppDialog title={file.name} onClose={onClose} wide>
      <div className="c-media-preview">{r}</div>
      <div className="button-row">
        <a className="primary-button" href={url} download={file.name}>
          <Icon name="download" />
          {" Download file"}
        </a>
      </div>
    </AppDialog>
  );
}

export function MediaFileDetailsDialog({ file, onClose, onSave }) {
  const [r, i] = useState(file.name);
  const [a, o] = useState(file.folder);
  const [s, c] = useState("");
  const [u, d] = useState(false);
  const f = useMemo(
    () => ({
      name: `media-name-${file.id}`,
      folder: `media-folder-${file.id}`,
    }),
    [file.id],
  );
  return (
    <AppDialog title="File details" onClose={onClose}>
      <form
        className="c-form"
        data-c-form="media"
        data-id={file.id}
        onSubmit={async (e) => {
          if ((e.preventDefault(), c(""), !r.trim() || !a.trim()))
            c("File name and folder are required.");
          else {
            d(true);
            try {
              await onSave({
                name: r.trim(),
                folder: a.trim(),
              });
            } catch (e) {
              c(
                e instanceof Error
                  ? e.message
                  : "File details could not be saved.",
              );
            } finally {
              d(false);
            }
          }
        }}
      >
        <label className="c-field" htmlFor={f.name}>
          <span>
            {"File name "}
            <small>*</small>
          </span>
          <input
            id={f.name}
            name="name"
            type="text"
            required
            maxLength={1e3}
            value={r}
            onChange={(e) => i(e.currentTarget.value)}
          />
        </label>
        <label className="c-field" htmlFor={f.folder}>
          <span>
            {"Folder "}
            <small>*</small>
          </span>
          <input
            id={f.folder}
            name="folder"
            type="text"
            required
            maxLength={1e3}
            value={a}
            onChange={(e) => o(e.currentTarget.value)}
          />
        </label>
        <p className="c-form-error" role="alert">
          {s}
        </p>
        <button type="submit" className="primary-button" disabled={u}>
          {u ? "Saving…" : "Save details"}
        </button>
      </form>
    </AppDialog>
  );
}

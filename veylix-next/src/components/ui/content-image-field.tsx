// @ts-nocheck
import { Fragment, useEffect, useState } from "react";
import { showToast } from "@/lib/events";
import { getMediaFile, saveMediaFile } from "@/lib/media-storage";

const contentImageTypePattern = /^image\/(png|jpeg|webp|gif)$/;

const MAX_CONTENT_IMAGE_BYTES = 20971520;

function validateContentImageFile(e) {
  if (!e || !contentImageTypePattern.test(e.type))
    throw Error("Choose a PNG, JPEG, WebP or GIF image.");
  if (!e.size || e.size > MAX_CONTENT_IMAGE_BYTES)
    throw Error("The image must be between 1 byte and 20 MB.");
}

async function saveContentImage(e, t = "Store content") {
  validateContentImageFile(e);
  const n = crypto.randomUUID();
  await saveMediaFile({
    id: n,
    name: e.name,
    type: e.type,
    size: e.size,
    folder: t,
    date: new Date().toISOString(),
    blob: e,
    starred: false,
    trashed: false,
  });
  return n;
}

export function ContentImageField({
  field,
  value = "",
  prefix = "field",
  folder = "Store content",
}) {
  const i = `${prefix}-${field.key}`;
  const [a, o] = useState(value == null ? "" : String(value));
  const [s, c] = useState("");
  const [u, d] = useState(false);
  const [f, p] = useState("");
  useEffect(() => {
    o(value == null ? "" : String(value));
  }, [value]);
  useEffect(() => {
    let e = true;
    let t = "";
    c("");
    return a
      ? (getMediaFile(a)
          .then((n) => {
            if (
              e &&
              !n?.trashed &&
              n?.blob &&
              /^image\/(png|jpeg|webp|gif)$/.test(String(n.type || ""))
            ) {
              t = URL.createObjectURL(n.blob);
              c(t);
            }
          })
          .catch(() => c("")),
        () => {
          e = false;
          if (t) {
            URL.revokeObjectURL(t);
          }
        })
      : () => void 0;
  }, [a]);
  return (
    <div
      className="c-field span-full c-content-image-field"
      data-content-image-field
    >
      <span>
        {field.label}
        {field.required ? (
          <Fragment>
            {" "}
            <small>*</small>
          </Fragment>
        ) : null}
      </span>
      <div className="c-content-image-control">
        <div className={`c-content-image-preview${s ? " has-image" : ""}`}>
          {s ? <img src={s} alt="" decoding="async" /> : "No image selected"}
        </div>
        <div className="c-content-image-actions">
          <label
            className="secondary-button c-content-image-upload"
            htmlFor={i}
          >
            Upload image
            <input
              id={i}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={u}
              onChange={async (e) => {
                const t = e.currentTarget;
                const n = t.files?.[0];
                if (n) {
                  d(true);
                  p("");
                  try {
                    const e = await saveContentImage(n, folder);
                    o(e);
                    showToast("Image uploaded. Save the record to apply it.");
                  } catch (e) {
                    const t =
                      e instanceof Error
                        ? e.message
                        : "Image could not be uploaded.";
                    p(t);
                    showToast(t);
                  } finally {
                    t.value = "";
                    d(false);
                  }
                }
              }}
              aria-label={`Upload ${field.label.toLowerCase()}`}
            />
          </label>
          <button
            type="button"
            className="secondary-button c-content-image-remove"
            disabled={!a || u}
            onClick={() => {
              o("");
              p("");
            }}
          >
            Remove image
          </button>
          <small>PNG, JPEG, WebP or GIF. Up to 20 MB.</small>
        </div>
      </div>
      <input
        type="hidden"
        name={field.key}
        value={a}
        data-image-folder={folder}
      />
      {f ? (
        <small className="c-form-error" role="alert">
          {f}
        </small>
      ) : null}
    </div>
  );
}

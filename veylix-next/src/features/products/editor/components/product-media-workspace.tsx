// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { ProductEditorSection } from "@/features/products/editor/components/product-editor-section";
import {
  hydrateProductImages,
  listMediaFiles,
  saveMediaFile,
  saveProductImages,
} from "@/lib/media-storage";

const MAX_PRODUCT_VIDEO_BYTES = 26214400;

function ProductMediaWorkspace({
  ids,
  videoId,
  onChange,
  onVideoChange,
  onUploadingChange,
  onError,
}) {
  const o = useRef(null);
  const s = useRef(null);
  const c = useRef(null);
  const [u, d] = useState("");
  const [f, p] = useState("");
  const [m, h] = useState(false);
  const [g, _] = useState("");
  useEffect(() => {
    if (o.current) {
      hydrateProductImages(o.current).catch((e) =>
        onError(
          e instanceof Error
            ? e.message
            : "Product images could not be loaded.",
        ),
      );
    }
  }, [ids, onError]);
  useEffect(() => {
    let e = true;
    let n = "";
    _("");
    return videoId
      ? (listMediaFiles()
          .then((r) => {
            const i = r.find(
              (e) =>
                e.id === videoId &&
                !e.trashed &&
                /^video\/(mp4|webm)$/.test(String(e.type || "")),
            );
            if (e && i?.blob) {
              n = URL.createObjectURL(i.blob);
              _(n);
            }
          })
          .catch(() =>
            p(
              "Video is unavailable. Remove this reference or upload the video again.",
            ),
          ),
        () => {
          e = false;
          if (n) {
            URL.revokeObjectURL(n);
          }
        })
      : () => void 0;
  }, [videoId]);
  const v = (e) => {
    h(e);
    onUploadingChange(e);
  };
  const y = async (t) => {
    if (t.length) {
      v(true);
      d("Saving images…");
      try {
        const r = await saveProductImages(t, ids.length);
        onChange([...ids, ...r]);
        d(
          `${r.length} image${r.length === 1 ? "" : "s"} added. Save the product to keep these gallery changes.`,
        );
      } catch (e) {
        const t = e instanceof Error ? e.message : "Images could not be saved.";
        d(t);
        onError(t);
      } finally {
        v(false);
        if (s.current) {
          s.current.value = "";
        }
      }
    }
  };
  const b = async (e) => {
    if (e) {
      v(true);
      p("Saving video…");
      try {
        if (!/^video\/(mp4|webm)$/.test(e.type))
          throw Error("Product video must be MP4 or WebM.");
        if (!e.size || e.size > MAX_PRODUCT_VIDEO_BYTES)
          throw Error("Product video must be between 1 byte and 25 MB.");
        const t = crypto.randomUUID();
        await saveMediaFile({
          id: t,
          name: e.name,
          type: e.type,
          size: e.size,
          folder: "Products",
          date: new Date().toISOString(),
          blob: e,
          starred: false,
          trashed: false,
        });
        onVideoChange(t);
        p("Video added. Save the product to keep this media change.");
      } catch (e) {
        const t = e instanceof Error ? e.message : "Video could not be saved.";
        p(t);
        onError(t);
      } finally {
        v(false);
        if (c.current) {
          c.current.value = "";
        }
      }
    }
  };
  const x = (t) => onChange(ids.filter((e, n) => n !== t));
  const S = (t) => {
    const r = [...ids];
    r.unshift(...r.splice(t, 1));
    onChange(r);
  };
  return (
    <div className="product-media-workspace">
      <fieldset className="product-gallery">
        <legend>Product image gallery</legend>
        <div className="product-editor-block-heading">
          <div>
            <h3>Product image gallery</h3>
            <p>
              Upload several product images, choose the cover and keep the
              storefront gallery organized.
            </p>
          </div>
          <span className="product-media-limit">
            PNG, JPEG or WebP · up to 6
          </span>
        </div>
        <input
          type="hidden"
          name="mediaIds"
          value={JSON.stringify(ids)}
          readOnly
        />
        <div
          className="product-gallery-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!m) {
              y([...(e.dataTransfer.files || [])]);
            }
          }}
        >
          <Icon name="upload" />
          <strong>Drop images here or choose files</strong>
          <span>Up to 5 MB per image. The first image becomes the cover.</span>
          <label className="primary-button c-upload-button">
            <Icon name="upload" />
            {" Upload images"}
            <input
              ref={s}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              aria-label="Upload product images"
              disabled={m}
              onChange={(e) => void y([...(e.target.files || [])])}
            />
          </label>
        </div>
        <div className="product-gallery-grid" data-product-gallery ref={o}>
          {ids.length ? (
            ids.map((e, t) => (
              <article key={`${e}-${t}`} className="product-gallery-item">
                <span className="product-uploaded" data-product-image={e} />
                <div className="product-gallery-item-meta">
                  <span>{t === 0 ? "Cover image" : `Image ${t + 1}`}</span>
                  <div>
                    {t ? (
                      <button type="button" onClick={() => S(t)}>
                        Set cover
                      </button>
                    ) : (
                      <em>Storefront cover</em>
                    )}
                    <button type="button" onClick={() => x(t)}>
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="product-gallery-empty">
              <Icon name="image" />
              <strong>No gallery images yet</strong>
              <span>Use the upload area above to add storefront photos.</span>
            </div>
          )}
        </div>
        <p className="product-upload-status" role="status">
          {u}
        </p>
      </fieldset>
      <section
        className="product-video-card"
        aria-labelledby="product-video-title"
      >
        <div className="product-editor-block-heading">
          <div>
            <h3 id="product-video-title">Product video</h3>
            <p>
              Optional video for product demonstrations, fit guidance or a short
              storefront showcase.
            </p>
          </div>
          <span className="product-media-limit">MP4 or WebM · up to 25 MB</span>
        </div>
        <input type="hidden" name="videoMediaId" value={videoId} readOnly />
        <div className="product-video-preview">
          {g ? (
            <video src={g} controls preload="metadata" playsInline />
          ) : (
            <div className="product-video-empty">
              <Icon name={videoId ? "info" : "play"} />
              <strong>
                {videoId ? "Video is unavailable" : "No product video uploaded"}
              </strong>
              <span>
                {videoId
                  ? "Remove this reference or upload the video again."
                  : "Add an optional MP4 or WebM video when motion helps explain the product."}
              </span>
            </div>
          )}
        </div>
        <div className="product-video-actions">
          <label className="secondary-button c-upload-button">
            <Icon name="upload" />
            {" Upload video"}
            <input
              ref={c}
              type="file"
              accept="video/mp4,video/webm"
              aria-label="Upload product video"
              disabled={m}
              onChange={(e) => void b(e.target.files?.[0])}
            />
          </label>
          {videoId ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                onVideoChange("");
                p("Video removed from this product. Save to keep the change.");
              }}
            >
              <Icon name="trash" />
              {" Remove video"}
            </button>
          ) : null}
        </div>
        <p className="product-upload-status" role="status">
          {f}
        </p>
      </section>
    </div>
  );
}

export function ProductMediaSection({
  values,
  setMediaIds,
  setVideoId,
  onUploadingChange,
  onError,
  hidden,
}) {
  return (
    <ProductEditorSection
      id="media"
      icon="image"
      title="Product media"
      description="Manage the storefront cover, gallery images and an optional product video."
      panel
      hidden={hidden}
    >
      <ProductMediaWorkspace
        ids={values.mediaIds}
        videoId={values.videoMediaId}
        onChange={setMediaIds}
        onVideoChange={setVideoId}
        onUploadingChange={onUploadingChange}
        onError={onError}
      />
    </ProductEditorSection>
  );
}

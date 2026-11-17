// @ts-nocheck

let mediaDatabasePromise;

function openMediaDatabase() {
  mediaDatabasePromise ||= new Promise((e, t) => {
    const n = indexedDB.open("veylix-media", 1);
    n.onupgradeneeded = () =>
      n.result.createObjectStore("files", {
        keyPath: "id",
      });
    n.onsuccess = () => e(n.result);
    n.onerror = () => t(Error("Local media storage is unavailable."));
  });
  return mediaDatabasePromise;
}

export async function listMediaFiles() {
  const e = await openMediaDatabase();
  return new Promise((t, n) => {
    const r = e.transaction("files").objectStore("files").getAll();
    r.onsuccess = () => t(r.result);
    r.onerror = () => n(Error("Unable to read the media library."));
  });
}

export async function getMediaFile(e) {
  if (!e) return;
  const t = await openMediaDatabase();
  return new Promise((n, r) => {
    const i = t.transaction("files").objectStore("files").get(e);
    i.onsuccess = () => n(i.result);
    i.onerror = () => r(Error("Unable to read this media file."));
  });
}

export async function saveMediaFile(e) {
  const t = await openMediaDatabase();
  return new Promise((n, r) => {
    const i = t.transaction("files", "readwrite");
    i.objectStore("files").put(e);
    i.oncomplete = n;
    i.onerror = () =>
      r(
        Error(
          "Your browser could not save this file. Check available storage.",
        ),
      );
  });
}

export async function uploadMediaFiles(e, t) {
  for (const n of e) {
    if (n.size > 20971520)
      throw Error(`${n.name} exceeds the 20 MB per-file limit.`);
    if (
      !/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm)|audio\/|application\/pdf|text\/plain)/.test(
        n.type,
      )
    )
      throw Error(
        "Supported: PNG, JPEG, WebP, GIF, MP4, WebM, audio, PDF and plain text.",
      );
    await saveMediaFile({
      id: crypto.randomUUID(),
      name: n.name,
      type: n.type,
      size: n.size,
      folder: t || "Uploads",
      date: new Date().toISOString(),
      blob: n,
      starred: false,
      trashed: false,
    });
  }
}

const productImageUrlCache = new Map();

function validateProductImageFiles(e, t = 0) {
  if (e.length + t > 6) throw Error("Choose up to 6 product images.");
  for (const t of e) {
    if (!/^image\/(png|jpeg|webp)$/.test(t.type))
      throw Error("Product images must be PNG, JPEG or WebP.");
    if (!t.size || t.size > 5242880)
      throw Error("Each product image must be between 1 byte and 5 MB.");
  }
}

export async function saveProductImages(e, t = 0) {
  validateProductImageFiles(e, t);
  for (const t of e) {
    let e;
    try {
      e = await createImageBitmap(t);
    } catch {
      throw Error(`${t.name} is not a readable image.`);
    } finally {
      e?.close();
    }
  }
  const n = [];
  for (const t of e) {
    const e = crypto.randomUUID();
    await saveMediaFile({
      id: e,
      name: t.name,
      type: t.type,
      size: t.size,
      folder: "Products",
      date: new Date().toISOString(),
      blob: t,
      starred: false,
      trashed: false,
    });
    n.push(e);
  }
  return n;
}

export async function hydrateProductImages(e) {
  const t = [...e.querySelectorAll("[data-product-image]")];
  if (!t.length) return;
  const n = await listMediaFiles();
  for (const e of t) {
    if (!e.isConnected) continue;
    const t = n.find((t) => t.id === e.dataset.productImage && !t.trashed);
    if (!t?.blob || !/^image\/(png|jpeg|webp)$/.test(t.type)) {
      e.textContent = "—";
      continue;
    }
    if (!productImageUrlCache.has(t.id)) {
      productImageUrlCache.set(t.id, URL.createObjectURL(t.blob));
    }
    const r = document.createElement("img");
    r.src = productImageUrlCache.get(t.id);
    r.alt = "";
    r.decoding = "async";
    e.replaceChildren(r);
  }
}

export function revokeProductImageUrls() {
  for (const e of productImageUrlCache.values()) URL.revokeObjectURL(e);
  productImageUrlCache.clear();
}

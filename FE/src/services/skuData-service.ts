import { clone, delay, newId } from "@/mocks/delay";
import { mockImportSummary, mockParseSheet } from "@/mocks/imports";
import { productSkuSeed } from "@/mocks/sku";
import type { ImportJobSummary } from "@/types/imports";
import type { GetProductSkuDataPayload, ProductSku, ProductSkuResponse } from "@/types/sku";

/** Mock of TrackVid-FE `api/skuData-service.ts`. */

let skus: ProductSku[] = clone(productSkuSeed);

const distinct = (values: string[]): string[] => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

const uploadSkuFile = async (payload: FormData): Promise<ImportJobSummary> => {
  await delay(700);
  const sheet = await mockParseSheet(payload.get("ProductSkucodeFile"), "SKU file");
  const now = new Date().toISOString();
  let inserted = 0;
  if (sheet.header.length) {
    const find = (name: RegExp) => sheet.header.findIndex((h) => name.test(h.replace(/\s+/g, "")));
    const iSku = find(/sellerskucode|sku/i);
    const iColor = find(/colou?r/i);
    const iSize = find(/size/i);
    const iImage = find(/image|link/i);
    if (iSku < 0) throw new Error("Missing required column: Seller SKU Code.");
    for (const r of sheet.rows) {
      const code = r[iSku];
      if (!code) continue;
      const existing = skus.find((s) => s.sellerSkuCode === code);
      const patch = { color: iColor >= 0 ? (r[iColor] ?? "") : "", size: iSize >= 0 ? (r[iSize] ?? "") : "", imageLink: iImage >= 0 ? (r[iImage] ?? "") : "", updatedAt: now };
      if (existing) skus = skus.map((s) => (s._id === existing._id ? { ...s, ...patch } : s));
      else {
        inserted += 1;
        skus = [{ _id: newId(), companyId: "64f0c0ffee0000000000c001", fileKey: `sku/${sheet.fileName}`, userId: "64f0c0ffee0000000000a001", sellerSkuCode: code, ...patch, createdAt: now, __v: 0 }, ...skus];
      }
    }
  } else {
    inserted = Math.min(4, sheet.rowCount);
    const fresh = Array.from({ length: inserted }, (_, i): ProductSku => ({ ...clone(productSkuSeed[i]), _id: newId(), sellerSkuCode: `UTN-NEW-${String(Date.now()).slice(-5)}-${i + 1}`, createdAt: now, updatedAt: now }));
    skus = [...fresh, ...skus];
  }
  return mockImportSummary(sheet, inserted, "SKU data");
};

const getProductSkuData = async (payload: GetProductSkuDataPayload): Promise<ProductSkuResponse> => {
  await delay(380);
  const q = payload.searchInput.trim().toLowerCase();
  const live = skus.filter((s) => !s.isDeleted);
  const rows = live.filter(
    (s) => (!q || s.sellerSkuCode.toLowerCase().includes(q)) && (!payload.color || s.color === payload.color) && (!payload.size || s.size === payload.size),
  );
  const start = (payload.page - 1) * payload.limit;
  return clone({
    order: rows.slice(start, start + payload.limit),
    metadata: { limit: payload.limit, page: payload.page, total: rows.length, totalPage: Math.max(1, Math.ceil(rows.length / payload.limit)) },
    colors: distinct(live.map((s) => s.color)),
    sizes: distinct(live.map((s) => s.size)),
  });
};

export const skuDataService = {
  uploadSkuFile,
  getProductSkuData,
};

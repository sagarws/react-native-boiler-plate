import { clone, delay, newId } from "@/mocks/delay";
import { externalOrdersSeed, mockImportSummary, mockParseSheet } from "@/mocks/imports";
import type { MessageResponse } from "@/types/common";
import type { ExternalOrder, ExternalOrdersPayload, ExternalOrdersResponse, ImportJobSummary } from "@/types/imports";

/** Mock of TrackVid-FE `api/externalOrder-service.ts` (Forward and Return AWB linking). */

let orders: ExternalOrder[] = clone(externalOrdersSeed);
const VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

const getExternalOrdersData = async (payload: ExternalOrdersPayload): Promise<ExternalOrdersResponse> => {
  await delay(380);
  const page = Math.max(1, Number(payload.page) || 1);
  const limit = Math.max(1, Number(payload.limit) || 10);
  const q = (payload.searchInput ?? "").trim().toLowerCase();
  const rows = orders
    .filter((o) => (!payload.import_platform || o.import_platform === payload.import_platform) && (!q || o.forward_awb.toLowerCase().includes(q) || o.return_awb.toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return clone({
    orders: rows.slice((page - 1) * limit, page * limit),
    metadata: { limit, page, total: rows.length, totalPage: Math.max(1, Math.ceil(rows.length / limit)) },
  });
};

const uploadExternalOrder = async (payload: FormData): Promise<ImportJobSummary> => {
  await delay(700);
  const platform = String(payload.get("importPlatform") ?? "");
  const type = String(payload.get("importType") ?? "");
  if (!platform) throw new Error("Please select an e-commerce platform");
  if (platform !== "flipkart" && !type) throw new Error("Please select an import type");
  const sheet = await mockParseSheet(payload.get("file"));
  const now = new Date().toISOString();
  const add = Math.min(5, sheet.rowCount);
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
  const fresh = Array.from({ length: add }, (): ExternalOrder => ({
    _id: newId(),
    userId: "64f0c0ffee0000000000a001",
    companyId: "64f0c0ffee0000000000c001",
    fileKey: `external/${sheet.fileName}`,
    return_awb: `RT${digits(10)}`,
    forward_awb: `14${digits(11)}`,
    forward_video_link: VIDEO,
    return_video_link: type === "return" ? VIDEO : "",
    import_platform: platform,
    import_type: type === "forward" ? "forward" : "return",
    createdAt: now,
    updatedAt: now,
    __v: 0,
  }));
  orders = [...fresh, ...orders];
  return mockImportSummary(sheet, add, "AWB links");
};

const deleteExternalOrder = async (payload: { ids: string[] }): Promise<MessageResponse> => {
  await delay(400);
  if (!payload.ids.length) throw new Error("Select at least one record to delete.");
  orders = orders.filter((o) => !payload.ids.includes(o._id));
  return { message: `${payload.ids.length} record(s) deleted successfully` };
};

/** TrackVid returns an Excel file URL; the mock returns CSV text for the selected (or all) rows. */
const downloadExternalOrder = async (payload: { ids: string[] }): Promise<{ fileName: string; csv: string; count: number }> => {
  await delay(500);
  const rows = payload.ids.length ? orders.filter((o) => payload.ids.includes(o._id)) : orders;
  const lines = [
    "Forward AWB,Return AWB,Platform,Import Type,Forward Video Link,Return Video Link,Imported At",
    ...rows.map((o) => [`="${o.forward_awb}"`, `="${o.return_awb}"`, o.import_platform, o.import_type, o.forward_video_link, o.return_video_link, o.createdAt].join(",")),
  ];
  return { fileName: "External_Imports.csv", csv: `﻿${lines.join("\n")}`, count: rows.length };
};

export const ExternalOrdersService = { getExternalOrdersData, uploadExternalOrder, deleteExternalOrder, downloadExternalOrder };

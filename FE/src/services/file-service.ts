import { delay } from "@/mocks/delay";

/** Mock of TrackVid-FE `api/file-service.ts`. Keys map to public sample media. */

const SAMPLE_VIDEOS = [
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm",
];

function pick(key: string): string {
  if (/\.(png|jpe?g|webp)$/i.test(key)) return key.startsWith("/") ? key : "/assets/images/products.webp";
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SAMPLE_VIDEOS[h % SAMPLE_VIDEOS.length];
}

/** Signed URL for a stored file (video or screenshot). */
const getFileUrl = async (key: string): Promise<{ url: string }> => {
  await delay(250);
  if (!key) throw new Error("File not found.");
  return { url: pick(key) };
};

/** Shareable Google Drive link for a stored file. */
const getDriveLink = async (key: string, name?: string): Promise<{ url: string }> => {
  await delay(400);
  return { url: `https://drive.google.com/file/d/mock-${encodeURIComponent(key)}/view${name ? `?name=${encodeURIComponent(name)}` : ""}` };
};

/** Retry cloud processing for a video still under raw/. */
const retryCloudProcessing = async (rawVideoKey: string): Promise<{ message: string }> => {
  await delay(500);
  return { message: `Processing restarted for ${rawVideoKey.split("/").pop() ?? rawVideoKey}.` };
};

export const FileService = { getFileUrl, getDriveLink, retryCloudProcessing };

/** YouTube Downloader types (native JSON is validated in services/youtube.ts). */

export type DownloadKind = 'video' | 'audio';

/** One quality the user can pick. */
export interface DownloadOption {
  id: string;
  kind: DownloadKind;
  /** e.g. "1080p", "2160p60", "128 kbps". */
  label: string;
  /** 0 for audio. */
  height: number;
  fps: number;
  /** File extension of the result: mp4 | webm | m4a | opus. */
  ext: string;
  /** H.264 | VP9 | AV1 | AAC | Opus. */
  codec: string;
  bitrateKbps: number;
  /** Estimated download size in bytes (0 when unknown). */
  sizeBytes: number;
}

export interface VideoDetails {
  id: string;
  url: string;
  title: string;
  author: string;
  durationSec: number;
  thumbnail: string;
  video: DownloadOption[];
  audio: DownloadOption[];
}

export type DownloadPhase = 'fetching' | 'downloading' | 'merging';

export interface ActiveDownload {
  id: string;
  title: string;
  label: string;
  phase: DownloadPhase;
  /** 0–1. */
  fraction: number;
}

export interface DownloadEntry {
  id: string;
  title: string;
  author: string;
  kind: DownloadKind;
  label: string;
  name: string;
  mime: string;
  sizeBytes: number;
  durationSec: number;
  createdAt: number;
}

export type DownloadEvent =
  | { type: 'progress'; active: ActiveDownload }
  | { type: 'completed'; entry: DownloadEntry }
  | { type: 'failed'; id: string; code: string }
  | { type: 'cancelled'; id: string };

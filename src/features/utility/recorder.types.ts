/**
 * Screen Recorder types. The native side (android/.../recorder/) owns the
 * settings, the session and the library; these mirror its JSON after
 * validation in services/recorder.service.ts.
 */

export const RECORDER_MODES = [
  'screenshot',
  'screen',
  'voice',
  'screen_voice',
] as const;
export type RecorderMode = (typeof RECORDER_MODES)[number];

export const AUDIO_SOURCES = ['system', 'mic', 'system_mic'] as const;
export type AudioSourceId = (typeof AUDIO_SOURCES)[number];

export const VIDEO_PRESETS = ['low', 'medium', 'high', 'custom'] as const;
export type VideoPreset = (typeof VIDEO_PRESETS)[number];

export const AUDIO_PRESETS = ['low', 'standard', 'high', 'custom'] as const;
export type AudioPreset = (typeof AUDIO_PRESETS)[number];

export const OUTPUT_KINDS = [
  'screenshot',
  'video',
  'voice',
  'merged',
  'segments',
] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/** Choices offered for the automatic segment length (minutes); any 1–120 is valid. */
export const SEGMENT_PRESETS = [1, 2, 5, 10, 15, 30] as const;
export const MIN_SEGMENT_MINUTES = 1;
export const MAX_SEGMENT_MINUTES = 120;

export interface CustomVideo {
  /** Short side, px (240–2160). */
  height: number;
  fps: number;
  /** bits/s */
  bitrate: number;
}

export interface CustomAudio {
  sampleRate: number;
  bitrate: number;
  channels: number;
}

export interface RecorderConfig {
  bubbleEnabled: boolean;
  mode: RecorderMode;
  longPressMenu: boolean;
  showControls: boolean;
  previewSeconds: number;
  autoSaveScreenshot: boolean;
  keepCaptureSession: boolean;
  videoPreset: VideoPreset;
  customVideo: CustomVideo;
  audioSource: AudioSourceId;
  audioPreset: AudioPreset;
  customAudio: CustomAudio;
  segmentEnabled: boolean;
  segmentMinutes: number;
  autoMerge: boolean;
  keepSegments: boolean;
  storageWarningMb: number;
  keepScreenOn: boolean;
}

/** Session states (RecordingState.kt). */
export type RecordingStateId =
  | 'idle'
  | 'requesting_permission'
  | 'preparing'
  | 'recording'
  | 'paused'
  | 'finalizing_segment'
  | 'starting_next_segment'
  | 'stopping'
  | 'merging'
  | 'verifying_output'
  | 'completed'
  | 'interrupted'
  | 'failed';

export interface RecorderStatus {
  supported: boolean;
  sdk: number;
  overlayPermission: boolean;
  micPermission: boolean;
  notifications: boolean;
  systemAudioSupported: boolean;
  bubbleShown: boolean;
  state: RecordingStateId;
  sessionMode: RecorderMode | null;
  elapsedMs: number;
  segment: number;
  /** What is being captured, e.g. "Video + system audio" (native string). */
  content: string;
  captureHeld: boolean;
  mergeProgress: number;
}

export type RecordingType = 'screenshot' | 'video' | 'audio';
export type RecordingStatus =
  | 'recording'
  | 'processing'
  | 'completed'
  | 'unmerged'
  | 'interrupted'
  | 'failed';
export type SegmentStatus = 'writing' | 'done' | 'failed' | 'deleted';
export type RecordingAudio = 'none' | AudioSourceId;

export interface RecordingSegment {
  index: number;
  name: string;
  startUs: number;
  durationUs: number;
  sizeBytes: number;
  status: SegmentStatus;
}

export interface Recording {
  id: string;
  type: RecordingType;
  name: string;
  /** '' until a final file exists. */
  uri: string;
  createdAt: number;
  endedAt: number | null;
  durationMs: number;
  sizeBytes: number;
  width: number;
  height: number;
  fps: number;
  audio: RecordingAudio;
  status: RecordingStatus;
  error: string;
  /** 0 = not segmented. */
  segmentMinutes: number;
  keepSegments: boolean;
  thumb: string;
  segments: RecordingSegment[];
}

export const LIBRARY_FILTERS = [
  'all',
  'screenshots',
  'videos',
  'audio',
  'processing',
  'interrupted',
  'failed',
] as const;
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number];

export interface DirectoryStatus {
  label: string;
  custom: boolean;
  accessible: boolean;
  freeBytes: number;
}

export interface VideoPlanInfo {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}

export interface VideoCapabilities {
  screenWidth: number;
  screenHeight: number;
  encoder: string;
  presets: Record<VideoPreset, VideoPlanInfo>;
}

/** A `RecorderEvent` from native. */
export interface RecorderEvent {
  type: string;
  body: Record<string, unknown>;
}

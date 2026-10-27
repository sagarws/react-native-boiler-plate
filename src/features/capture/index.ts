export { default as ExtractedTextScreen } from './screens/ExtractedTextScreen';
export { OcrModePicker } from './components/OcrModePicker';
export type { OcrModePickerProps } from './components/OcrModePicker';
export { ResultListItem } from './components/ResultListItem';
export { useCaptureSettings } from './hooks/useCaptureSettings';
export { useHistory, useLatestResult } from './hooks/useHistory';
export { useOverlayController } from './hooks/useOverlayController';
export type { UseOverlayController } from './hooks/useOverlayController';
export { useCaptureSync } from './hooks/useCaptureSync';
export { clearAllCaptures } from './services/captureSync.service';
export { screenOcrService } from './services/screenOcr.service';
export { BUBBLE_OPACITY, BUBBLE_SIZE } from './store/captureSettings.store';
export type {
  CaptureSettings,
  OcrMode,
  OcrResult,
  OverlayNotice,
  OverlayStatus,
} from './capture.types';
export { OCR_MODES } from './capture.types';
export { OverlayNoticeBanner } from './components/OverlayNoticeBanner';
export { useSpeechInfo } from './hooks/useSpeechInfo';
export type { UseSpeechInfo } from './hooks/useSpeechInfo';
export {
  speechService,
  engineLabel,
  unspeakableScripts,
  VOICE_SAMPLES,
  GOOGLE_TTS,
} from './services/speech.service';
export {
  SPEECH_RATE,
  SPEECH_PITCH,
  MAX_SECTIONS,
  MAX_NO_NEW_TEXT,
} from './store/captureSettings.store';
export type {
  FloatingAction,
  SpeechLanguage,
  SpeechSettings,
  ReadingSettings,
  SpeechInfo,
  SpeechOutcome,
  VoiceInfo,
} from './capture.types';
export {
  FLOATING_ACTIONS,
  SPEECH_LANGUAGES,
  OCR_MODE_SCRIPTS,
} from './capture.types';
export { FloatingActionPicker } from './components/FloatingActionPicker';
export { usePaginationTarget } from './hooks/usePaginationTarget';
export type { UsePaginationTarget } from './hooks/usePaginationTarget';
export {
  paginationService,
  parseTargetStatus,
} from './services/pagination.service';
export {
  PAGE_LOAD_DELAY,
  VERIFY_TIMEOUT,
  MAX_PAGES,
} from './store/captureSettings.store';
export type {
  PaginationSettings,
  PaginationTargetStatus,
  TargetProblem,
} from './capture.types';

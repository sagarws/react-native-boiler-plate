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
  PREVIEW_SAMPLES,
  VOICE_LANGUAGE_ORDER,
  voicesFor,
  savedVoiceStatus,
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
  PreviewOutcome,
  SavedVoiceStatus,
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
export { useVoicePreview } from './hooks/useVoicePreview';
export type { UseVoicePreview } from './hooks/useVoicePreview';
export { useGeminiKey } from './hooks/useGeminiKey';
export type { UseGeminiKey } from './hooks/useGeminiKey';
export {
  translateService,
  looksLikeApiKey,
  parseKeyStatus,
} from './services/translate.service';
export type {
  GeminiKeyStatus,
  GeminiTestOutcome,
  GeminiReport,
  GeminiModelInfo,
} from './services/translate.service';
export { THINKING_LEVELS } from './capture.types';
export type { ThinkingLevel } from './capture.types';
export {
  DEFAULT_TRANSLATE_MODEL,
  DEFAULT_TRANSLATE_PROMPT,
  MAX_TRANSLATE_PROMPT,
} from './store/captureSettings.store';
export type { TranslateSettings, RefineSettings } from './capture.types';
export { DEFAULT_REFINE_PROMPT } from './store/captureSettings.store';
export { useAudioShare } from './hooks/useAudioShare';
export type { UseAudioShare } from './hooks/useAudioShare';
export {
  audioShareService,
  parseAudioShareStatus,
  AUDIO_SHARE_OFF,
} from './services/audioShare.service';
export type {
  AudioShareStatus,
  AudioShareState,
} from './services/audioShare.service';
export type { AudioShareSettings } from './capture.types';

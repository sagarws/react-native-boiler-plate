import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

type ScriptProgressError = { awbNumber: string; error: string };

interface ScriptProgressData {
  total: number;
  running: number;
  success: number;
  failed: number;
  processed: number;
  jobId: string | null;
  skippedAwbNumbers: string[];
  failedAwbNumbers: string[];
  errors: ScriptProgressError[];
  queued?: number; // Number of items in queue
  status?: "QUEUED" | "RUNNING"; // Current job status
  queuePosition?: number; // Position in queue (1-based)
  totalInQueue?: number; // Total jobs waiting in queue
}

interface ScriptProgressState {
  open: boolean;
  isMinimized: boolean;
  isCompleted: boolean;
  manuallyClosed: boolean;
  activeJobId: string | null;
  progress: ScriptProgressData;
}

const initialState: ScriptProgressState = {
  open: false,
  isMinimized: false,
  isCompleted: false,
  manuallyClosed: false,
  activeJobId: null,
  progress: {
    total: 0,
    running: 0,
    success: 0,
    failed: 0,
    processed: 0,
    jobId: null,
    skippedAwbNumbers: [],
    failedAwbNumbers: [],
    errors: [],
    queued: 0,
    status: undefined,
    queuePosition: undefined,
    totalInQueue: undefined,
  },
};

const scriptProgressSlice = createSlice({
  name: "scriptProgress",
  initialState,
  reducers: {
    startScriptProgress(
      state,
      action: PayloadAction<{ total: number; running: number; jobId: string | null }>
    ) {
      state.open = true;
      state.isMinimized = false;
      state.isCompleted = false;
      state.manuallyClosed = false;
      state.activeJobId = action.payload.jobId;
      state.progress = {
        ...state.progress,
        total: action.payload.total,
        running: action.payload.running,
        success: 0,
        failed: 0,
        processed: 0,
        jobId: action.payload.jobId,
        skippedAwbNumbers: [],
        failedAwbNumbers: [],
        errors: [],
      };
    },
    updateScriptProgress(
      state,
      action: PayloadAction<Partial<ScriptProgressData>>
    ) {
      const nextJobId = action.payload.jobId ?? state.progress.jobId;
      if (nextJobId) {
        state.activeJobId = nextJobId;
      }
      state.progress = {
        ...state.progress,
        ...action.payload,
        jobId: nextJobId ?? null,
        skippedAwbNumbers: action.payload.skippedAwbNumbers ?? state.progress.skippedAwbNumbers,
        failedAwbNumbers: action.payload.failedAwbNumbers ?? state.progress.failedAwbNumbers,
        errors: action.payload.errors ?? state.progress.errors,
      };
      const total = state.progress.total;
      const processed = state.progress.processed;
      const running = state.progress.running;
      if (total > 0 && processed === total && running === 0) {
        state.isCompleted = true;
      }
      if (!state.manuallyClosed) {
        state.open = true;
      }
    },
    completeScriptProgress(
      state,
      action: PayloadAction<Partial<ScriptProgressData>>
    ) {
      state.isCompleted = true;
      state.progress = {
        ...state.progress,
        ...action.payload,
      };
      if (!state.manuallyClosed) {
        state.open = true;
      }
    },
    setScriptProgressMinimized(state, action: PayloadAction<boolean>) {
      state.isMinimized = action.payload;
    },
    setScriptProgressOpen(state, action: PayloadAction<boolean>) {
      state.open = action.payload;
      if (!action.payload) {
        state.isMinimized = false;
      }
    },
    setScriptProgressManuallyClosed(state, action: PayloadAction<boolean>) {
      state.manuallyClosed = action.payload;
    },
    setActiveScriptJob(state, action: PayloadAction<string | null>) {
      state.activeJobId = action.payload;
      state.progress.jobId = action.payload;
    },
    closeScriptProgress(state) {
      state.open = false;
      state.isMinimized = false;
      state.isCompleted = false;
      state.manuallyClosed = true;
      state.activeJobId = null;
      state.progress = { ...initialState.progress };
    },
    resetScriptProgress() {
      return initialState;
    },
  },
});

export const {
  startScriptProgress,
  updateScriptProgress,
  completeScriptProgress,
  setScriptProgressMinimized,
  setScriptProgressOpen,
  setScriptProgressManuallyClosed,
  setActiveScriptJob,
  closeScriptProgress,
  resetScriptProgress,
} = scriptProgressSlice.actions;

export const scriptProgressReducer = scriptProgressSlice.reducer;

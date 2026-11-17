import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface OtpPromptRequest {
  jobId: string;
  username: string;
  cmsIds: string[];
  requestedAt: string;
}

export type OtpResolution = "CONSUMED" | "INVALID" | "TIMEOUT";

interface OtpPromptState {
  queue: OtpPromptRequest[];
  current: OtpPromptRequest | null;
  submitting: boolean;
  lastResolution: { jobId: string; resolution: OtpResolution } | null;
}

const initialState: OtpPromptState = {
  queue: [],
  current: null,
  submitting: false,
  lastResolution: null,
};

const otpPromptSlice = createSlice({
  name: "otpPrompt",
  initialState,
  reducers: {
    enqueueOtpRequest(state, action: PayloadAction<OtpPromptRequest>) {
      const incoming = action.payload;
      const duplicate =
        state.current?.jobId === incoming.jobId ||
        state.queue.some((entry) => entry.jobId === incoming.jobId);
      if (duplicate) return;

      if (!state.current) {
        state.current = incoming;
      } else {
        state.queue.push(incoming);
      }
    },
    promoteNextOtpRequest(state) {
      state.current = state.queue.shift() ?? null;
      state.submitting = false;
    },
    resolveOtpRequest(
      state,
      action: PayloadAction<{ jobId: string; resolution: OtpResolution }>
    ) {
      const { jobId, resolution } = action.payload;
      state.lastResolution = { jobId, resolution };

      if (state.current?.jobId === jobId) {
        state.current = state.queue.shift() ?? null;
        state.submitting = false;
        return;
      }
      state.queue = state.queue.filter((entry) => entry.jobId !== jobId);
    },
    setOtpSubmitting(state, action: PayloadAction<boolean>) {
      state.submitting = action.payload;
    },
    clearOtpQueue() {
      return initialState;
    },
  },
});

export const {
  enqueueOtpRequest,
  promoteNextOtpRequest,
  resolveOtpRequest,
  setOtpSubmitting,
  clearOtpQueue,
} = otpPromptSlice.actions;

export const otpPromptReducer = otpPromptSlice.reducer;

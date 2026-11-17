import { configureStore } from "@reduxjs/toolkit";
import { useDispatch as useReduxDispatch, useSelector as useReduxSelector, type TypedUseSelectorHook } from "react-redux";
import { notificationReducer } from "@/store/notification-slice";
import { otpPromptReducer } from "@/store/otp-prompt-slice";
import { profileReducer } from "@/store/profile-slice";
import { scriptProgressReducer } from "@/store/script-progress-slice";

/** Cross-screen state only (profile, notifications, CMS script progress, OTP prompts). Screens keep their own data. */
export function makeStore() {
  return configureStore({
    reducer: {
      profile: profileReducer,
      notification: notificationReducer,
      scriptProgress: scriptProgressReducer,
      otpPrompt: otpPromptReducer,
    },
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];

export const useDispatch: () => AppDispatch = useReduxDispatch;
export const useSelector: TypedUseSelectorHook<RootState> = useReduxSelector;

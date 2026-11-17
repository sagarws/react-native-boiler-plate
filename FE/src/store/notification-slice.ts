import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { errorMessage } from "@/lib/events";
import type { BackgroundJobs, Notifications } from "@/mocks/notifications";
import { NotificationsService } from "@/services/notification-service";

export type { BackgroundJobs, Notifications };

export interface NotificationState {
  loadingNotification: boolean;
  errorFetchingNotification: string;
  notifications: Notifications[];
  backgroundJobs: BackgroundJobs;
}

const initialState: NotificationState = {
  loadingNotification: true,
  errorFetchingNotification: "",
  notifications: [],
  backgroundJobs: { importNotifications: [] },
};

export const fetchNotifications = createAsyncThunk<Notifications[], void, { rejectValue: string }>(
  "notification/fetch",
  async (_, { rejectWithValue }) => {
    try {
      return await NotificationsService.getAllNotifications();
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const fetchBackgroundJobs = createAsyncThunk("notification/jobs", () => NotificationsService.getBackgroundJobs());

export const markNotificationRead = createAsyncThunk("notification/markRead", async (id: string) => {
  await NotificationsService.markAsRead(id);
  return id;
});

export const markAllNotificationsRead = createAsyncThunk("notification/markAllRead", async () => {
  await NotificationsService.markAllAsRead();
});

export const archiveNotification = createAsyncThunk("notification/archive", async (id: string) => {
  await NotificationsService.archiveNotification(id);
  return id;
});

const notificationSlice = createSlice({
  name: "notification",
  initialState,
  reducers: {
    setLoadingNotificationSuccess(state, action: PayloadAction<Notifications[]>) {
      state.loadingNotification = false;
      state.notifications = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchNotifications.pending, (state) => {
        state.loadingNotification = true;
        state.errorFetchingNotification = "";
      })
      .addCase(fetchNotifications.fulfilled, (state, action) => {
        state.loadingNotification = false;
        state.notifications = action.payload;
      })
      .addCase(fetchNotifications.rejected, (state, action) => {
        state.loadingNotification = false;
        state.errorFetchingNotification = action.payload ?? "Could not load notifications.";
      })
      .addCase(fetchBackgroundJobs.fulfilled, (state, action) => {
        state.backgroundJobs = action.payload;
      })
      .addCase(markNotificationRead.fulfilled, (state, action) => {
        state.notifications = state.notifications.map((n) => (n._id === action.payload ? { ...n, is_read: true } : n));
      })
      .addCase(markAllNotificationsRead.fulfilled, (state) => {
        state.notifications = state.notifications.map((n) => ({ ...n, is_read: true }));
      })
      .addCase(archiveNotification.fulfilled, (state, action) => {
        state.notifications = state.notifications.filter((n) => n._id !== action.payload);
      });
  },
});

export const { setLoadingNotificationSuccess } = notificationSlice.actions;
export const notificationReducer = notificationSlice.reducer;

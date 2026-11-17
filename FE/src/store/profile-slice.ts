import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { errorMessage } from "@/lib/events";
import { UserService } from "@/services/user-service";
import type { IUser } from "@/types/common";

export interface ProfileState {
  userLoading: boolean;
  userProfile: IUser | null;
  userError: string | null;
}

const initialState: ProfileState = { userLoading: false, userProfile: null, userError: null };

/** Same as TrackVid `getUserProfile` middleware, backed by the mock UserService. */
export const getUserProfile = createAsyncThunk<IUser, void, { rejectValue: string }>(
  "profile/getUserProfile",
  async (_, { rejectWithValue }) => {
    try {
      return await UserService.getUser();
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

const profileSlice = createSlice({
  name: "profile",
  initialState,
  reducers: {
    setUserProfile(state, action: PayloadAction<IUser>) {
      state.userProfile = action.payload;
      state.userLoading = false;
      state.userError = null;
    },
    resetProfile() {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getUserProfile.pending, (state) => {
        state.userLoading = true;
        state.userError = null;
      })
      .addCase(getUserProfile.fulfilled, (state, action) => {
        state.userLoading = false;
        state.userProfile = action.payload;
      })
      .addCase(getUserProfile.rejected, (state, action) => {
        state.userLoading = false;
        state.userError = action.payload ?? "Could not load your profile.";
      });
  },
});

export const { setUserProfile, resetProfile } = profileSlice.actions;
export const profileReducer = profileSlice.reducer;

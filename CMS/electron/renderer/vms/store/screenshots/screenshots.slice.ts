import { createSlice, type PayloadAction } from '../slice'

/**
 * Screenshots captured during a recording session. Kept as data-URLs so the
 * gallery panel can render them straight into <img src>. Cap at MAX_ITEMS to
 * match the shipping app's "N / 15" counter - the backend rejects claims with
 * more than 15 screenshots per order, so there is no point letting the
 * gallery grow past that.
 *
 * Cleared automatically after a successful upload dispatches setVideoUpload
 * Success (see the OrderCapture handler) and manually via the Clear button.
 */

export const MAX_SCREENSHOTS = 15

export interface Screenshot {
  id: string
  /** data:image/jpeg;base64,... - ready for <img src> and FormData. */
  dataUrl: string
  /** epoch ms when the frame was grabbed. */
  capturedAt: number
}

export interface ScreenshotsState {
  items: Screenshot[]
}

const initialState: ScreenshotsState = { items: [] }

export const screenshotsSlice = createSlice({
  name: 'screenshots',
  initialState,
  reducers: {
    addScreenshot: (state, action: PayloadAction<Screenshot>) => {
      if (state.items.length >= MAX_SCREENSHOTS) return
      state.items.push(action.payload)
    },
    removeScreenshot: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter((item) => item.id !== action.payload)
    },
    clearScreenshots: (state) => {
      state.items = []
    }
  }
})

export const { addScreenshot, removeScreenshot, clearScreenshots } = screenshotsSlice.actions
export const screenshotsReducer = screenshotsSlice.reducer

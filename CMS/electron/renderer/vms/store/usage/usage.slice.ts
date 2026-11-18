import { createSlice, type PayloadAction } from '../slice'
import type { DiskInfo } from '@shared/vms/system'
import type { UsageSnapshot } from '@shared/vms/usage'

/**
 * Renderer-side snapshot of system usage.
 *
 * Ported from TrackVid 1.1.x usage.slice. The credits/quota fields are
 * deliberately left out for now - they belong to the /usage endpoint that
 * lands with the marketplace-CMS commits. Only the storage-check surface is
 * relevant to the ops-check subsystem shipping in this arc.
 */

export interface UsageState {
  systemStorageInfo: DiskInfo | null
  /**
   * True once the operator has been shown the out-of-storage warning at least
   * once this session. Stops the provider re-navigating there on every poll
   * after the operator has clicked Ok.
   */
  isStorageWarningAppeared: boolean
  /** Server-side account quota. Null until /account/usage returns. */
  usage: UsageSnapshot | null
}

const initialState: UsageState = {
  systemStorageInfo: null,
  isStorageWarningAppeared: false,
  usage: null
}

export const usageSlice = createSlice({
  name: 'usage',
  initialState,
  reducers: {
    setSystemStorageInfo: (state, action: PayloadAction<DiskInfo | null>) => {
      state.systemStorageInfo = action.payload
    },
    setStorageWarningAppeared: (state, action: PayloadAction<boolean>) => {
      state.isStorageWarningAppeared = action.payload
    },
    setUsage: (state, action: PayloadAction<UsageSnapshot | null>) => {
      state.usage = action.payload
    }
  }
})

export const { setSystemStorageInfo, setStorageWarningAppeared, setUsage } = usageSlice.actions
export const usageReducer = usageSlice.reducer

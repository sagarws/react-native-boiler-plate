import type { MirrorOutcome, MirrorState } from '@shared/vms/partnerVms'

/**
 * The log line for an order that was not mirrored — TrackVid-App's orderLog
 * warning from src/main/index.ts. Failure lines name the fix, because whoever
 * reads this is deciding what to do, not what happened. Keyed by AWB, so
 * `grep <AWB>` in the log tells that order's whole story.
 */
const FIX: Partial<Record<MirrorState, string>> = {
  LOGGED_OUT: 'log in on the Flipkart VMS tab',
  WRONG_SCREEN: 'open the Flipkart VMS tab and go to Operator → VMS',
  NOT_CONNECTED: 'connect the desk feed on the Flipkart VMS tab',
  DEGRADED: 'check the Flipkart VMS tab, the page looked wrong',
  BOOTING: 'wait, the Flipkart VMS page is still loading'
}

/** When the state is READY the state name explains nothing — only the reason does. */
const WHY: Record<string, string> = {
  record_not_started:
    'their page never started recording after the AWB was entered, which usually means it rejected the number',
  wrong_route: 'their page had navigated away from the operator screen',
  selector_missing: 'a control on their page could not be found',
  not_ready: 'their page was not in a usable state',
  superseded: 'the next parcel was scanned before this one reached their page',
  degraded: 'their page no longer matches what TrackVid knows how to drive'
}

export const notMirroredLine = (awb: string, outcome: MirrorOutcome): string => {
  const detail = outcome.reason ? ` ${WHY[outcome.reason] ?? outcome.reason}` : ''
  return (
    `[${awb}] Not mirrored to Flipkart VMS —${detail}` +
    ` (state ${outcome.state}${outcome.detail ? `, ${outcome.detail}` : ''}); ` +
    `${FIX[outcome.state] ?? 'check the Flipkart VMS tab'}; TrackVid recorded it normally.`
  )
}

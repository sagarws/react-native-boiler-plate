/** Main asks the page to confirm closing while `holder` is still running. */
export interface CloseGuardRequest {
  /** What is running, as the operator knows it — "A scheduled automation". */
  holder: string
}

/** The operator's answer: quit anyway, naming what was running. */
export interface CloseGuardQuit {
  holder: string
}

/**
 * Shapes shared by every account-mapping probe.
 *
 * Platform-specific fields do NOT belong here — they go in the platform's own
 * folder, mirroring @trackvid/automation-core.
 */

/** One of the company's logins, as a mapping run sees it. */
export interface MappingCredential {
  username: string
  credentialId: string
  accountType: string
}

/** What a probe answers about one AWB. */
export interface ProbeAnswer {
  found: boolean
  /** A second identifier the hit resolved — AJIO's `{ pobId }`. */
  scope?: { pobId?: string } | null
  /** Whatever else the marketplace happened to say. Meesho's sub-order number lives here. */
  details?: Record<string, unknown> | null
}

/**
 * An account, opened once and asked many times.
 *
 * A factory rather than a plain function because opening the account is the
 * expensive half: a sign-in, and on two platforms a browser. A run over three
 * hundred claims asks the same five accounts three hundred times each, so
 * paying for the login per claim would make the tool unusable — the sign-in
 * happens once and every claim reuses it.
 */
export interface AccountProbe {
  /**
   * @param alternates other identifiers for the SAME return — Meesho's
   *   sub-order number — tried only when the AWB itself finds nothing.
   *
   *   Optional, and ignored by every probe but Meesho's: the other platforms
   *   have a TYPED AWB search, so there is nothing else they could be asked
   *   with. It earns its place because a stale AWB misses on every account, and
   *   the run then reports the row as belonging to nobody — which reads as a
   *   problem with the accounts rather than with the number being asked about.
   */
  ask: (awb: string, alternates?: string[]) => Promise<ProbeAnswer>
  /** Releases whatever `open` acquired. Always called, including after a throw. */
  close: () => Promise<void>
}

export type ProbeOpener = (credential: MappingCredential) => Promise<AccountProbe>

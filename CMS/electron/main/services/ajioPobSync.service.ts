import { fail, ok, type Result } from "@shared/types/result";
import { apiRequest } from "./httpClient";
import { getAccessToken } from "./session.store";
import { withAutomationLock } from "./automationLock";
import {
  credentialFor,
  orderedPobIds,
  refreshCompany,
} from "./company.service";
import { sweepAjioPobs } from "../automations/platforms/ajio/common/pobSync";
import { logger } from "./logger";
import { broadcast } from "@main/ipc/broadcast";
import { PLATFORM_SESSION_EVENTS } from "@shared/constants/channels";

/**
 * "Sync POBs" for one AJIO account, from this machine.
 *
 * The Monitor has the same button and takes a longer road: it asks TrackVid,
 * which asks the automation server, which opens a browser and reuses whatever
 * session THAT machine holds. This app already has a signed-in AJIO page — it
 * opens one to file claims — and the browser lease means a sync pressed during
 * a run costs nothing at all.
 *
 * It matters more here than it does there. A POB list is a precondition for
 * almost everything this app asks AJIO: the claim search is scoped to one, the
 * account mapping sweeps them, the SKU picker searches under one and the report
 * is filtered by them. All four refuse without it, and "never synced" is
 * otherwise invisible until one of them fails.
 */

type PobSyncResult = {
  username: string;
  pobIds: string[];
  added: number;
  removed: number;
};

/**
 * Sweep AJIO for one account's POBs and store them — WITHOUT the automation
 * lock. `syncAjioPobs` is this inside the lock; `ensureAjioPobs` is this for a
 * caller that already holds it (the lock is not re-entrant, so taking it again
 * from inside a report read would wait on itself for ever).
 */
const sweepAndStore = async (
  username: string,
): Promise<Result<PobSyncResult>> => {
  const token = getAccessToken();

  if (!token) return fail("VALIDATION_ERROR", "Sign in to sync POBs");

  let swept: Awaited<ReturnType<typeof sweepAjioPobs>>;

  try {
    swept = await sweepAjioPobs(username);
  } catch (error) {
    return fail(
      "INTERNAL_ERROR",
      error instanceof Error
        ? error.message
        : "Could not read the POBs from AJIO",
    );
  }

  if (swept.pobIds.length === 0) {
    // Refused rather than written, exactly as the server's path refuses one:
    // zero POBs means the sweep found nothing — a mid-pagination failure, or
    // an account on the wrong side of the Enterprise switch — and storing []
    // would destroy a working list on a transient failure.
    return fail(
      "INTERNAL_ERROR",
      `AJIO returned no POBs for ${username} via ${swept.source}. The stored list is unchanged. ` +
        (swept.enterpriseLevel
          ? "This account is marked Enterprise — if that is wrong, turn it off in Monitor and retry."
          : "If this account is Enterprise, turn that on in Monitor and retry."),
    );
  }

  return storePobs(token, username, swept.pobIds, swept.source);
};

/** Writes a non-empty POB list to the credential, then the local copy. */
const storePobs = async (
  token: string,
  username: string,
  pobIds: string[],
  source: string,
): Promise<Result<PobSyncResult>> => {
  const stored = await apiRequest<PobSyncResult>("/cms/ajio/sync-pobs", {
    method: "POST",
    token,
    body: { username, pobIds },
  });

  if (!stored.success) return stored;

  // The local copy is what every AJIO tool here reads its POBs from, so it
  // has to catch up now rather than at the next Sync — otherwise the button
  // reports success and the tools carry on refusing.
  await refreshCompany();

  logger.info(
    `[ajio-pobs] ${username}: ${stored.data.pobIds.length} POB(s) via ${source}` +
      (stored.data.added > 0 ? `, ${stored.data.added} new` : ""),
  );

  return ok(stored.data);
};

/**
 * The POB ids the login itself read, off the session record it saved.
 *
 * AJIO's session extras call the same work-places endpoint from the signed-in
 * window and send the answer with the jar — but the ingest keeps it on the
 * SESSION, not on the credential's POB list, so a fresh login still read
 * "POBs — not synced". Empty for an Enterprise account: work-places is the
 * standard endpoint, and its answer there is not the list pobsFromUserId gives.
 */
const pobIdsFromSession = (
  credential: Awaited<ReturnType<typeof credentialFor>>,
): string[] => {
  if (!credential || credential.isEnterpriseLevel === true) return [];

  const raw = credential.session?.pobIds;

  if (!Array.isArray(raw)) return [];

  return [
    ...new Set(
      raw
        .map((entry: unknown): unknown =>
          entry !== null && typeof entry === "object"
            ? (entry as Record<string, unknown>).id
            : entry,
        )
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  ];
};

export const syncAjioPobs = async (
  payload: unknown,
): Promise<Result<PobSyncResult>> => {
  const asked = (payload as { username?: unknown })?.username;
  const username = typeof asked === "string" ? asked.trim() : "";

  if (!username) return fail("VALIDATION_ERROR", "No AJIO account was given");

  // Takes the lock like any other browser work. While a run holds a signed-in
  // AJIO page this borrows it and opens nothing.
  return withAutomationLock("ajio-pob-sync", () => sweepAndStore(username));
};

/** One sweep per account at a time: the backup reads months in parallel. */
const inFlight = new Map<string, Promise<string[]>>();

/** A failed sweep, remembered briefly so a run's next page does not sweep again at once. */
const recentFailure = new Map<string, { at: number; message: string }>();

const FAILURE_MEMORY_MS = 2 * 60 * 1000;

/**
 * The account's POB IDs — fetched from AJIO first when none are stored.
 *
 * For the AJIO report reads, which used to refuse with "First sync all POB IDs"
 * and leave the operator to go and press Sync POBs. Now the read does it and
 * carries on. Throws, naming the fix, only when the sweep itself fails.
 *
 * Does NOT take the automation lock: its callers run inside it already.
 */
export const ensureAjioPobs = async (username: string): Promise<string[]> => {
  const held = orderedPobIds(
    (await credentialFor("ajio", username))?.pobIds ?? [],
  );

  if (held.length > 0) return held;

  const key = username.toLowerCase();
  const failed = recentFailure.get(key);

  if (failed && Date.now() - failed.at < FAILURE_MEMORY_MS)
    throw new Error(failed.message);

  const running = inFlight.get(key);

  if (running) return running;

  const sweep = (async (): Promise<string[]> => {
    logger.info(
      `[ajio-pobs] ${username}: no POB IDs stored — fetching them before the report`,
    );

    const result = await sweepAndStore(username);

    if (!result.success) {
      const message =
        `No POB IDs are stored for ${username}, and fetching them failed: ${result.error.message} ` +
        "Run Sync POBs for this account in Monitor, then try again.";

      recentFailure.set(key, { at: Date.now(), message });
      throw new Error(message);
    }

    recentFailure.delete(key);

    // Re-read rather than trusting the answer: the local copy is what every
    // other AJIO tool reads, so the report should see what they will.
    const fresh = orderedPobIds(
      (await credentialFor("ajio", username))?.pobIds ?? [],
    );

    return fresh.length > 0 ? fresh : result.data.pobIds;
  })();

  inFlight.set(key, sweep);

  try {
    return await sweep;
  } finally {
    inFlight.delete(key);
  }
};

/**
 * AJIO's after-session step (SESSION_FOLLOW_UPS): fetch the POBs when the
 * account has none stored.
 *
 * A Login page capture saved the session and stopped there, so an account that
 * had never been synced kept reading "POBs (0)" until somebody pressed it — and
 * every AJIO tool here refuses without the list. An account that already has
 * POBs is left alone: re-sweeping on every capture would cost a paged API read
 * to rebuild a list already held.
 *
 * Detached from the capture, so it takes the automation lock like any other
 * browser work and borrows the page the session just landed in.
 */
export const syncMissingAjioPobs = async (
  username: string,
): Promise<Result<unknown>> => {
  const name = username.trim();

  if (!name) return fail("VALIDATION_ERROR", "No AJIO account was given");

  // The capture may have just written POBs through the ingest — read them back
  // before deciding there are none.
  await refreshCompany();

  const credential = await credentialFor("ajio", name);

  if ((credential?.pobIds ?? []).length > 0) return ok({ skipped: true });

  const token = getAccessToken();
  const fromLogin = pobIdsFromSession(credential);

  logger.info(
    `[ajio-pobs] ${name}: no POB IDs stored after the login — ` +
      (fromLogin.length > 0 && token
        ? `storing the ${fromLogin.length} the login read`
        : "fetching them now"),
  );

  // The login already read them: store those, with no second browser. That
  // browser was the weak link — it reopens the portal and sweeps while the
  // SPA is still routing itself, which aborts the fetch ("Failed to fetch").
  // Swept only when the login brought none back, or their store was refused.
  let result: Result<PobSyncResult> =
    fromLogin.length > 0 && token
      ? await storePobs(token, name, fromLogin, "the login")
      : fail("VALIDATION_ERROR", "The login read no POBs");

  if (!result.success) {
    if (fromLogin.length > 0)
      logger.warn(
        `[ajio-pobs] ${name}: could not store the login's POBs (${result.error.message}) — sweeping instead`,
      );

    result = await syncAjioPobs({ username: name });
  }

  // The Login page reads the count from the local copy; tell it to look again.
  if (result.success)
    broadcast(PLATFORM_SESSION_EVENTS.changed, {
      platform: "ajio",
      username: name,
    });

  return result;
};

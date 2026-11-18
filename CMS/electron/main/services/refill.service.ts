import { randomUUID } from "node:crypto";
import { CLAIM_REFILL_EVENTS } from "@shared/constants/channels";
import { refillFieldsFor } from "@shared/constants/refill";
import type {
  RefillField,
  RefillProgress,
  RefillRowResult,
  RefillSummary,
} from "@shared/types/refill";
import { fail, ok, type Result } from "@shared/types/result";
import type { ClaimDocument } from "@main/automations/common/types";
import { prepareCoreWithBrowser } from "@main/automations/common/prepareCore";
import { loadCore } from "@main/automations/common/coreLoader";
import { refillPlatform } from "@main/automations/refill/registry";
import type { RefillValues } from "@main/automations/refill/types";
import type { MappingCredential } from "@main/automations/accountMapping/types";
import { platformSkipped } from "./platformSkip.store";
import { rememberStatusSynced } from "./statusSync.store";
import { SIGN_IN_REFUSED, withoutSignIn } from "./signInPolicy";
import { broadcast } from "../ipc/broadcast";
import { apiRequest } from "./httpClient";
import { MAX_REFILL_ATTEMPTS, refillExhausted } from "@shared/constants/refill";
import { canEditTicket } from "@shared/constants/claims";
import { getAccessToken } from "./session.store";
import { mappingAccounts } from "./mappingAccounts.service";
import { withAutomationLock } from "./automationLock";
import { ProbePool } from "./accountMapping.service";
import { writeRefillJob } from "./refillArchive.store";
import { logger } from "./logger";

/**
 * "Refill Data" — asking the marketplace for the blanks on a claim that exists.
 *
 * A row from a scan or a feed carries an AWB and little else, and the missing
 * pieces are the ones that decide whether it can be filed at all: the account,
 * the identifier its claim form is keyed on, the forward leg's AWB, and — once
 * a ticket exists — where that ticket now stands. All of it is knowable by
 * asking, and asking is what nobody has time to do by hand across hundreds of
 * rows.
 *
 * NOT A SWEEP. It works on the rows an operator ticked, with the fields they
 * ticked, and it FILLS BLANKS: a value somebody typed outranks one a search
 * resolved. The exception is the status, which is reported rather than filled —
 * a ticket Myntra now calls PAYMENT_COMPLETED is Paid whatever the row said.
 *
 * ONE CALL WHERE THE MARKETPLACE MAKES ONE. Meesho answers the account and the
 * sub-order number in the same response, Myntra the account and the forward
 * AWB; the resolvers collapse that rather than asking the same endpoint twice.
 */

/** Rows the operator ticked, as the renderer sends them. */
interface RequestedClaim {
  cmsId: string;
  awb: string;
}

interface RefillPayload {
  platform?: unknown;
  claims?: unknown;
  fields?: unknown;
  /**
   * Does this run spend a row's refill budget?
   *
   * The BLANKS pass does: three fruitless asks about an AWB means the number
   * is wrong and a fourth answers nothing. The STATUS pass does not — "still
   * In Review" is the answer, not a failed ask, and capping it would stop
   * tracking a ticket after three nights, which is the one thing it is for.
   *
   * Defaults to true, so every caller that predates the split behaves exactly
   * as it did.
   */
  countsAttempt?: unknown;
  /**
   * Asked before each row: true ends the sweep there. The scheduled passes
   * hand in their own — switching Automations off must stop a 455-row sweep,
   * not leave it holding the browser for an hour after the task was abandoned.
   * Main-process only; nothing over IPC can carry a function.
   */
  shouldStop?: unknown;
}

interface MappingEngine {
  mapAwbToAccount: (input: {
    awb: string;
    /** Other names for the same return, tried only when the AWB finds nothing. */
    alternates?: string[];
    accounts: MappingCredential[];
    probe: (
      account: MappingCredential,
      awb: string,
      alternates: string[],
    ) => Promise<{ found: boolean }>;
    keyOf?: (account: MappingCredential) => string;
    recent?: unknown;
    logger?: unknown;
  }) => Promise<{
    matched: MappingCredential | null;
    /**
     * Where the hit was found, when finding it needed more than the account.
     *
     * AJIO's is `{ pobId }` — its probe sweeps the login's places of business,
     * so the POB that answered is part of the answer. Null for every platform
     * whose account identifies the row on its own.
     */
    scope: { pobId?: string } | null;
    /** Whatever else the winning probe said — Meesho's sub-order number. */
    details?: Record<string, unknown> | null;
    attempts: { key: string; found: boolean; error: string | null }[];
    errors: { key: string; error: string }[];
  }>;
  /** One sentence saying what a miss actually means — see the core. */
  describeMiss: (awb: string, result: unknown) => string;
  RecentFirst: new () => unknown;
}

interface ApplyResponse {
  applied: Record<string, string>;
  skipped: { field: string; reason: string }[];
  replaced: { field: string; from: string; to: string }[];
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/**
 * Replaces a row's ticket number with the corrected one a resolver found — a
 * Delhivery row that was recorded with the internal ticket UUID instead of its
 * "J…" number.
 *
 * ONLY WHILE THE TICKET MAY BE EDITED (Pending, Failed to Proceed, In Review):
 * `/cms/update-ticket` moves a claim to In Review unconditionally, and an
 * Approved or Rejected claim must not be demoted to fix its ticket's spelling.
 * Never fatal — the status still gets written either way.
 */
export const correctTicketNumber = async (
  token: string,
  cmsId: string,
  doc: ClaimDocument,
  corrected: string | null | undefined,
): Promise<void> => {
  const current = text((doc as { ticketNumber?: unknown }).ticketNumber);
  const status = text((doc as { status?: unknown }).status);

  if (!corrected || corrected === current) return;

  if (!canEditTicket(status)) {
    logger.info(
      `[refill] ${cmsId}: ticket ${current} is Delhivery's internal id (${corrected} is the real one), ` +
        `left as it is — the claim is ${status || "in a status"} that a ticket edit would demote`,
    );

    return;
  }

  const saved = await apiRequest<unknown>("/cms/update-ticket", {
    method: "PUT",
    token,
    body: { _id: cmsId, ticket: corrected, source: "desktop" },
  });

  if (saved.success) {
    logger.info(`[refill] ${cmsId}: ticket corrected ${current} → ${corrected}`);
  } else {
    logger.warn(
      `[refill] ${cmsId}: could not correct ticket ${current} → ${corrected}: ${saved.error.message}`,
    );
  }
};

const requested = (payload: RefillPayload): RequestedClaim[] =>
  (Array.isArray(payload?.claims) ? payload.claims : [])
    .map((entry) => entry as { cmsId?: unknown; awb?: unknown })
    .map((entry) => ({ cmsId: text(entry.cmsId), awb: text(entry.awb) }))
    .filter((entry) => entry.cmsId && entry.awb);

/**
 * How many refills this row has already had. Absent on every row written before
 * the field existed, and absent must read as none rather than as "stop".
 */
const attemptsOn = (doc: ClaimDocument): number => {
  const value = (doc as Record<string, unknown>).refillAttempt;

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

/** The account the row already names, under whichever key its platform uses. */
const accountOn = (doc: ClaimDocument): string => {
  const row = doc as Record<string, unknown>;
  const nested = (key: string): string =>
    text((row[key] as Record<string, unknown> | undefined)?.username);

  return (
    text(row.ajio_account_email) ||
    text(row.meesho_account_email) ||
    text(row.snapdeal_account_username) ||
    nested("myntraClaimDetails") ||
    nested("nykaaClaimDetails") ||
    nested("otherClaimDetails")
  );
};

/**
 * Did the marketplace refuse to ANSWER, rather than answer "nothing"?
 *
 * THE DISTINCTION THE REFILL BUDGET TURNS ON. Three fruitless asks retires a
 * row for good, and that is right when the marketplace keeps saying it has
 * never heard of the AWB — a fourth ask answers neither. It is wrong when the
 * marketplace never looked: a rate limit, a 502, a dropped connection. Those
 * say nothing about the row, and charging them spends a row's whole budget on
 * the state of somebody's gateway.
 *
 * WHAT THIS COST, in the case that found it. A Meesho sweep of twelve rows ran
 * back to back, Meesho answered two of them with
 * `HTTP 429 — you've made too many requests`, and both were charged an attempt.
 * The same AWB refilled by hand minutes later, first try, with the same
 * account. Three nights of that and the row is retired for ever, by a cron,
 * over a rate limit — while the button an operator presses still works, which
 * is exactly how this stayed invisible.
 *
 * MATCHED ON THE MESSAGE, because that is what every path here has in common:
 * the core throws Error with the status in the text, and the shapes differ by
 * platform and by flow. A miss costs one wrongly-charged attempt, the state
 * before this existed — so the list errs towards catching too much.
 */
/**
 * How long to wait before asking a marketplace that has just refused to look.
 *
 * Long enough for a burst limit to clear, short enough that a sweep of
 * hundreds is not meaningfully slower — only the rows that were refused wait
 * at all.
 */
const RETRY_PAUSE_MS = 6_000

export const marketplaceDidNotAnswer = (message: string): boolean =>
  // A sign-in this run declined to make. The marketplace was never asked, so
  // the row learned nothing and must not pay for it — see signInPolicy.
  message.includes(SIGN_IN_REFUSED) ||
  /\b(429|408|5\d\d)\b/.test(message) ||
  /too many requests|rate.?limit|timed? ?out|timeout|socket hang up|econn|enotfound|etimedout|network error|gateway|service unavailable|temporarily unavailable/i.test(
    message,
  );

export const runRefill = async (
  payload: unknown,
): Promise<Result<RefillSummary>> => {
  const request = (payload ?? {}) as RefillPayload;
  const countsAttempt = request.countsAttempt !== false;
  const shouldStop =
    typeof request.shouldStop === "function"
      ? (request.shouldStop as () => boolean)
      : () => false;
  const platform = text(request.platform).toLowerCase();
  const claims = requested(request);
  const offered = refillFieldsFor(platform);
  // Only fields this platform can actually answer. A renderer that offered one
  // it cannot is a bug, and silently attempting it would be a worse one.
  const fields = (Array.isArray(request.fields) ? request.fields : [])
    .map((field) => text(field) as RefillField)
    .filter((field) => offered.includes(field));

  /**
   * ASK THE MARKETPLACE INSTEAD OF THIS MACHINE.
   *
   * AJIO's refill is answered from the local report backup: no login, no
   * network, instant — and only as complete as the backup is. AJIO caps a
   * report window at 10,000 rows, so a busy month is partial until it has been
   * re-read in pieces, and a row whose day is missing comes back unfillable
   * with nothing to say why.
   *
   * With this on, the account and the POB are asked of AJIO directly, through
   * the same probe the mapping run used: `/dashboard/dropship/return/pob/
   * {pobId}/list?returnAwbNo=…` over the last 365 days, POB by POB. Slower and
   * it needs a session, but it answers for rows the backup has never held.
   *
   * Off by default, because the fast local answer is the right one whenever the
   * backup has the row.
   */
  const useApis = (payload as { useApis?: unknown })?.useApis === true;

  const token = getAccessToken();

  if (!platform) return fail("VALIDATION_ERROR", "No platform was given");
  if (offered.length === 0)
    return fail(
      "VALIDATION_ERROR",
      `There is nothing to refill on ${platform}`,
    );
  if (claims.length === 0)
    return fail("VALIDATION_ERROR", "Select the claims to refill first");
  if (fields.length === 0)
    return fail("VALIDATION_ERROR", "Pick at least one field to refill");
  if (!token) return fail("VALIDATION_ERROR", "Sign in to refill data");

  /**
   * LEFT OUT, NOT ATTEMPTED: an account whose sign-in costs a one-time code and
   * whose session is not live.
   *
   * Signing one of those in needs somebody to fetch a code, which a batch
   * cannot do and should not wait on. The session gate has already offered the
   * re-capture and the operator has chosen to go ahead, so the run uses the
   * logins that CAN answer rather than spending a minute per row failing on the
   * one that cannot. Its rows come back "no account holds this AWB", which is
   * true of the accounts that were asked. `mappingAccounts` also puts the
   * accounts holding a live session first, so a sweep pays for as few sign-ins
   * as the claims allow.
   */
  const accounts: MappingCredential[] = await mappingAccounts(platform);

  // A platform that answers from this machine needs no login to do it — AJIO's
  // account comes from the POB on a backed-up row, not from signing in.
  // Asking the marketplace needs a login even on a platform that normally
  // answers from disk, so the gate below applies to it too.
  if (
    accounts.length === 0 &&
    (useApis || !refillPlatform(platform)?.offline)
  ) {
    return fail(
      "VALIDATION_ERROR",
      `No ${platform} logins are configured for this company`,
    );
  }

  /*
   * THIS RUN DOES NOT SIGN IN.
   *
   * A refill that met a dead session used to sign in by script — one browser,
   * one real login, per account — in the middle of a sweep of hundreds of
   * rows. Re-capturing logins is the Login update's job; it runs first for
   * exactly that reason, and now stops the schedule when it cannot. A refill
   * doing it again turns a run of API calls into a night of browser sessions.
   *
   * A row whose account has no usable login fails, saying so, and is asked
   * again on the next run — after the Login update has had its turn. It costs
   * the row no refill attempt: the marketplace was never asked.
   */
  return withAutomationLock("refill", () =>
    withoutSignIn(() =>
      sweep(
        platform,
        claims,
        fields,
        accounts,
        token,
        useApis,
        countsAttempt,
        shouldStop,
      ),
    ),
  );
};

/**
 * Shut down whatever the resolvers kept in `contexts`.
 *
 * Most of them keep a cookie jar or a bearer token, which needs no closing.
 * Tata CliQ keeps a signed-in BROWSER, because its portal is behind Cloudflare
 * and every call has to come from inside a logged-in page — and a browser left
 * open is a Chromium per account that outlives the run.
 *
 * Duck-typed rather than a required field on the context, because a resolver
 * with nothing to close should not have to say so.
 */
export const closeRefillContexts = async (
  contexts: Map<string, unknown>,
): Promise<void> => {
  for (const [username, ctx] of contexts) {
    const close = (ctx as { close?: () => Promise<void> } | null)?.close;

    if (typeof close !== "function") continue;

    try {
      await close();
    } catch (error) {
      // Reported, never thrown: the run is over and its results are already
      // counted, so a browser that would not shut down must not turn a
      // finished refill into a failed one.
      logger.warn(
        `[refill] could not close the session for ${username}: ${String(error)}`,
      );
    }
  }
};

/**
 * The fields a claim about to be FILED is still missing — asked for that one
 * claim, through the account that was just established.
 *
 * WHY THE ACCOUNT WAS NEVER THE ONLY BLANK. A claim that arrives over the
 * socket without an account is a row nobody has looked at: it is missing
 * whatever the account was missing with it. Snapdeal's form is keyed on the
 * sub-order number, Meesho's the same, AJIO's needs the POB and the seller SKU,
 * Myntra's wants the forward AWB — and the search that answered "which login
 * holds this AWB" is the same search that carries all of them. So the answers
 * are taken while the session is open, rather than failing the claim on a blank
 * the marketplace had already told us.
 *
 * NOT `runRefill`. That one is a sweep: it takes the automation lock, opens its
 * own probes and broadcasts progress to the Refill Data dialog. This runs
 * INSIDE a claim that already holds the lock, so it uses the resolver directly
 * and the caller's own session map.
 *
 * NO STATUS. `statusChange` reports where a FILED ticket stands, and this claim
 * has not been filed — asking would be a call whose answer cannot exist, and
 * writing one would move a queued row's status on the strength of it.
 *
 * Fill-blank at the backend, like every other refill: a value an operator typed
 * is never replaced by one a search resolved.
 *
 * @returns the fields actually written, for the claim's log. Empty is ordinary
 *          — the row may already have carried everything.
 */
export const refillClaimFields = async ({
  platform,
  cmsId,
  doc,
  awb,
  username,
  token,
  contexts,
}: {
  platform: string;
  cmsId: string;
  doc: ClaimDocument;
  awb: string;
  username: string;
  token: string;
  contexts: Map<string, unknown>;
}): Promise<string[]> => {
  const resolver = refillPlatform(platform)?.resolve;

  if (!resolver) return [];

  const fields = refillFieldsFor(platform).filter(
    (field) => field !== "accountMapping" && field !== "statusChange",
  );

  if (fields.length === 0) return [];

  const values = await resolver({
    doc,
    awb,
    username,
    ticketNumber:
      text((doc as { ticketNumber?: unknown }).ticketNumber) || null,
    fields,
    contexts,
  });

  if (values.missing) {
    logger.info(`[claim-refill] ${platform} ${cmsId}: ${values.missing}`);

    return [];
  }

  const body: Record<string, unknown> = { cmsId };

  if (values.subOrderNumber) body.subOrderNumber = values.subOrderNumber;
  if (values.forwardAWB) body.forwardAWB = values.forwardAWB;
  if (values.sellerSku) body.sellerSku = values.sellerSku;
  if (values.pobId) body.pobId = values.pobId;

  // Nothing came back. Not worth a round trip to say so.
  if (Object.keys(body).length === 1) return [];

  const applied = await apiRequest<ApplyResponse>("/cms/refill-apply", {
    method: "POST",
    token,
    body,
  });

  /**
   * ONTO THE DOCUMENT THE RUNNER IS ABOUT TO READ — including `config`, which
   * the backend built from the row as it was BEFORE any of this and is what a
   * claim sequence actually reads. Stamping only the top-level fields left the
   * runner filing with the same blank that started this.
   *
   * Done whether or not the write-back succeeded: the value is the
   * marketplace's answer either way, and refusing to file over a failed write
   * would waste the search that found it.
   */
  stampRefilled(doc, values);

  if (!applied.success) {
    logger.warn(
      `[claim-refill] ${platform} ${cmsId}: resolved ${Object.keys(body)
        .filter((key) => key !== "cmsId")
        .join(
          ", ",
        )} but the write-back failed (${applied.error.message}) — filing with them anyway`,
    );

    return [];
  }

  const wrote = Object.keys(applied.data.applied ?? {});

  if (wrote.length > 0) {
    logger.info(
      `[claim-refill] ${platform} ${cmsId}: filled ${wrote.join(", ")}`,
    );
  }

  return wrote;
};

/**
 * Where each resolved value belongs on the in-memory claim.
 *
 * TWO PLACES PER FIELD, because a claim document carries the row's own field
 * AND the `config` bundle the backend pre-built for the runner — and the
 * sequences read the bundle. The pairs are the backend's own mapping
 * (`getPlatformConfig`): `seller_sku` is `config.sku`, `pobid` is
 * `config.pobid`, and Meesho's `subOrderNumber` keeps its name.
 *
 * FILL-BLANK HERE TOO, matching the server: a value already on the document was
 * put there by somebody, and a search does not get to overrule it.
 */
const stampRefilled = (doc: ClaimDocument, values: RefillValues): void => {
  const config = doc.config ?? null;

  const put = (
    value: string | null | undefined,
    field: string,
    configKey: string,
  ): void => {
    if (!value) return;

    if (!text(doc[field])) doc[field] = value;
    if (config && !text(config[configKey])) config[configKey] = value;
  };

  put(values.subOrderNumber, "subOrderNumber", "subOrderNumber");
  put(values.forwardAWB, "forwardAWB", "forwardAWB");
  put(values.sellerSku, "seller_sku", "sku");
  put(values.pobId, "pobid", "pobid");
};

const sweep = async (
  platform: string,
  claims: RequestedClaim[],
  fields: RefillField[],
  accounts: MappingCredential[],
  token: string,
  useApis = false,
  /**
   * Does this sweep spend a row's refill budget?
   *
   * The BLANKS pass does: three fruitless asks about an AWB means the number
   * is wrong and a fourth answers nothing. The STATUS pass does not — "still
   * In Review" is the answer, not a failed ask, and capping it would stop
   * tracking a ticket after three nights, which is the one thing it is for.
   */
  countsAttempt = true,
  shouldStop: () => boolean = () => false,
): Promise<Result<RefillSummary>> => {
  const entry = refillPlatform(platform);
  /**
   * Both of these are the platform's DEFAULT, and "Use APIs" overrides both.
   *
   * `offline` says the answers are on this machine; `answersAccount` says the
   * resolver supplies the account itself, so the mapping probes are skipped.
   * AJIO is the only platform that sets either, and with the toggle on it
   * behaves like every other: a browser is opened and the account and POB are
   * asked of the marketplace.
   */
  const offline = entry?.offline === true && !useApis;
  const answersAccount = entry?.answersAccount === true && !useApis;

  // No browser for a platform whose answers are on disk. Starting one would
  // cost thirty seconds and a Chromium process to read a JSON file.
  if (!offline) {
    await prepareCoreWithBrowser(
      (message) => logger.info(`[refill] ${message}`),
      platform,
    );
  }

  entry?.reset?.();

  const { mapAwbToAccount, describeMiss, RecentFirst } =
    loadCore<MappingEngine>("common/accountMapping");
  const pool = new ProbePool(platform);
  const recent = new RecentFirst();
  const contexts = new Map<string, unknown>();
  const resolver = entry?.resolve ?? null;
  const jobId = randomUUID();
  const startedAt = new Date().toISOString();
  const rows: RefillRowResult[] = [];
  /** Rows this run actually worked — one `refillAttempt` each, reported once below. */
  const attemptedIds: string[] = [];
  /** Rows left alone because their refill budget was already spent. */
  const cappedIds: string[] = [];

  /**
   * ONE LOGIN, NOTHING TO ASK.
   *
   * When the account is the only thing wanted and the company has a single
   * login on this platform, the answer is already known — every claim on the
   * platform belongs to it. Asking the marketplace once per row to be told
   * something arithmetic is a browser session and several minutes spent on a
   * foregone conclusion.
   */
  const shortcut =
    !offline &&
    fields.length === 1 &&
    fields[0] === "accountMapping" &&
    accounts.length === 1;
  const onlyAccount = accounts[0]?.username ?? "";

  if (shortcut) {
    logger.info(
      `[refill] ${platform}: one login (${onlyAccount}) — writing it without asking`,
    );
  }

  const counted = (outcome: RefillRowResult["outcome"]): number =>
    rows.filter((row) => row.outcome === outcome).length;

  const publish = (current: string | null, running: boolean): void => {
    const progress: RefillProgress = {
      platform,
      fields,
      total: claims.length,
      done: rows.length,
      filled: counted("filled"),
      untouched: counted("nothing-to-do"),
      notFound: counted("not-found"),
      failed: counted("failed"),
      current,
      recent: [...rows].reverse().slice(0, 8),
      running,
    };

    broadcast(CLAIM_REFILL_EVENTS.progress, progress);
  };

  publish(claims[0]?.awb ?? null, true);

  try {
    for (const claim of claims) {
      /*
       * PASSED OVER BY HAND, mid-marketplace.
       *
       * The whole point of the per-platform Skip: a marketplace grinding
       * through 580 rows should not hold up the six behind it. Checked per
       * CLAIM rather than per platform, because a skip that waited for the
       * marketplace to finish would arrive after the thing it was meant to
       * prevent.
       *
       * The rows not asked about are left exactly as they were — no attempt
       * spent, nothing written — so the next run picks them up normally.
       */
      // Either task: the blanks pass runs as Refill Data, the status pass as
      // Status change, and a skip only ever exists for the one that is running.
      if (
        platformSkipped("refill-data", platform) ||
        platformSkipped("status-change", platform)
      ) {
        logger.info(
          `[refill] ${platform}: skipped by hand with ${claims.length - rows.length} row(s) unasked`,
        );
        break;
      }

      // Automations switched off under a scheduled pass: stop between rows,
      // leaving the rest unasked for the next run, and free the browser.
      if (shouldStop()) {
        logger.info(
          `[refill] ${platform}: stopped — Automations switched off, ${claims.length - rows.length} row(s) unasked`,
        );
        break;
      }

      publish(claim.awb, true);

      /*
       * ONE RETRY, AFTER A PAUSE, WHEN THE MARKETPLACE REFUSED TO LOOK.
       *
       * A rate limit is "ask again in a moment", and the nightly sweep is the
       * one caller that can afford to wait — nobody is watching it. Without
       * this the row was simply reported failed and left for the next run,
       * which arrives a day later and hits the same limit from the same burst.
       *
       * THE PAUSE IS THE POINT, not the retry. These sweeps run rows back to
       * back with no spacing at all, which is what provokes the limit; a few
       * seconds of quiet is usually the whole fix.
       *
       * ONLY ONE, and only for a refusal to answer. A marketplace that says
       * "no such AWB" means it, and asking twice is a request spent to be told
       * the same thing.
       */
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          if (attempt > 0)
            await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));

          const response = await apiRequest<ClaimDocument | null>(
            "/cms/find-by-awb",
            {
              method: "POST",
              token,
              body: { awb: claim.awb, platform },
            },
          );

          if (!response.success) throw new Error(response.error.message);
          if (!response.data)
            throw new Error(`No claim found for AWB ${claim.awb}`);

          const doc = response.data;

          /*
           * ITS BUDGET IS SPENT, so nothing below runs for this row.
           *
           * Checked here rather than before the loop because this is the first
           * point the count is known — and the read above is one the sweep makes
           * anyway, so a capped row costs that request and not the browser
           * session behind it. Three fruitless asks is a row whose AWB is wrong
           * or whose return belongs to an account this company does not hold, and
           * a fourth ask answers neither.
           */
          if (countsAttempt && refillExhausted(attemptsOn(doc))) {
            cappedIds.push(claim.cmsId);
            logger.info(
              `[refill] ${platform}: skipping ${claim.awb} — ${MAX_REFILL_ATTEMPTS} refills already spent on it`,
            );

            continue;
          }

          // Counted from here: the row is about to be worked, and the budget
          // counts the ASK. A row nobody could answer is exactly the case the cap
          // exists for, so it must be counted the same as one that was filled.
          if (countsAttempt) attemptedIds.push(claim.cmsId);

          const named = accountOn(doc);
          let username = named;
          /** What the login sweep concluded, when it concluded nothing. */
          let missReason = "";
          /**
           * What the account probe learned beside the account itself — Meesho's
           * Returns search answers the sub-order number in the same row that
           * proved the account. Kept, so it is not asked a second time.
           */
          let probed: Record<string, unknown> | null = null;
          /** The account was found by asking the marketplace in THIS run. */
          let mappedNow = false;

          /**
           * A platform that answers its own account is asked once, up front.
           *
           * The order matters: everywhere else the account has to be established
           * before anything else can be asked, because the rest of the questions
           * are put to that account's session. Here one local lookup answers all
           * four fields at once, so establishing the account IS the lookup.
           */
          let local: Awaited<ReturnType<NonNullable<typeof resolver>>> | null =
            null;

          /**
           * What the ACCOUNT probe learned beyond the account itself.
           *
           * Only AJIO fills this — its probe has to find which POB owns the
           * return before it can say which login does, so the POB is a by-product
           * of the search rather than a second question.
           */
          const scoped: { pobId?: string } = {};

          if (answersAccount && resolver) {
            local = await resolver({
              doc,
              awb: claim.awb,
              username,
              ticketNumber:
                text((doc as { ticketNumber?: unknown }).ticketNumber) || null,
              fields,
              contexts,
            });

            if (fields.includes("accountMapping") && !username)
              username = local.username ?? "";
          }

          // The account, when it is wanted and not already known. The shortcut
          // above skips the asking; everything else asks each login in turn and
          // stops at the first that owns the AWB.
          if (
            !answersAccount &&
            fields.includes("accountMapping") &&
            !username
          ) {
            if (shortcut) {
              username = onlyAccount;
            } else {
              const result = await mapAwbToAccount({
                awb: claim.awb,
                // The row's own sub-order number, where it has one. On Meesho a
                // stale AWB misses on every account, and the sweep then says the
                // return belongs to nobody — which sends somebody to fix the
                // sessions rather than the number.
                alternates: [
                  text((doc as { subOrderNumber?: unknown }).subOrderNumber),
                ].filter(Boolean),
                accounts,
                probe: async (account, awb, alternates) =>
                  (await pool.probe(account)).ask(awb, alternates),
                keyOf: (account) => account.username,
                recent,
                logger,
              });

              username = result.matched?.username ?? "";
              mappedNow = Boolean(username);
              probed = (result.details as Record<string, unknown> | null) ?? null;
              /**
               * THE PROBE ALREADY KNOWS THE POB, and it used to be thrown away.
               *
               * An AJIO return is found by sweeping the account's POBs, so a hit
               * names the one that owns it — `scope.pobId`. The mapping run
               * discarded it and only kept the username, which left the POB blank
               * on exactly the rows this had just located. It is the other half
               * of what an AJIO claim cannot be filed without.
               */
              const pobId = text(
                (result.scope as { pobId?: unknown } | null)?.pobId,
              );

              if (pobId && fields.includes("pobId")) scoped.pobId = pobId;

              // "Nobody has it" and "nobody could be asked" look identical in a
              // status column and call for opposite responses — check the row,
              // versus fix the sessions. The core writes that sentence; throwing
              // it away and saying "No account holds X" was losing the only part
              // of the answer that says what to do next.
              if (!username) missReason = describeMiss(claim.awb, result);
            }
          }

          /**
           * ONE LOGIN, ONE POSSIBLE ANSWER.
           *
           * Everything else here is asked THROUGH an account, so a row that names
           * none usually stops. But a company with a single login on the platform
           * has already answered the question — every claim there belongs to it —
           * and on Nykaa that is the permanent state: one login owns every
           * ticket, and no row carries an account at all.
           *
           * Not the same as the shortcut above, which WRITES the account when it
           * was asked for. This only uses it to ask the remaining questions.
           */
          if (!username && accounts.length === 1) {
            username = onlyAccount;
          }

          // An account is what every OTHER question is asked through, so without
          // one there is nothing more to do. Not so for a local answer: the
          // backup's row carries the SKU and the POB whether or not the POB
          // resolved to a login.
          if (!username && !offline) {
            rows.push({
              cmsId: claim.cmsId,
              awbNumber: claim.awb,
              filled: {},
              kept: [],
              outcome: "not-found",
              message: fields.includes("accountMapping")
                ? missReason || `No account holds ${claim.awb}`
                : "The claim names no account, so nothing else could be asked",
            });

            continue;
          }

          // Everything the marketplace can say beyond the account. Already in
          // hand for a platform that answered everything locally.
          const rest = fields.filter((field) => field !== "accountMapping");

          /*
           * WHAT THE ACCOUNT PROBE ALREADY ANSWERED is not asked again.
           *
           * Meesho's account probe IS the Returns search, and its row carries
           * the sub-order number. Asking the resolver for it repeated that same
           * search seconds later — and Meesho answered the repeat with HTTP 429
           * "too many requests", which failed the whole row and threw away the
           * account the first search had just found.
           */
          const fromProbe: RefillValues = {};
          const probedSubOrder = text(probed?.subOrderNumber);

          if (probedSubOrder && rest.includes("subOrderNumber")) fromProbe.subOrderNumber = probedSubOrder;

          const stillToAsk = rest.filter((field) => !(field in fromProbe));
          let askFailed = "";
          let asked: RefillValues = {};

          if (!local && stillToAsk.length > 0 && resolver) {
            try {
              asked = await resolver({
                doc,
                awb: claim.awb,
                username,
                ticketNumber:
                  text((doc as { ticketNumber?: unknown }).ticketNumber) || null,
                fields: stillToAsk,
                contexts,
              });
            } catch (error) {
              /*
               * AN ACCOUNT FOUND IS NEVER THROWN AWAY. When this run just
               * proved which login holds the AWB, a later question failing (a
               * rate limit, a timeout) must not cost the row its account: it is
               * written with whatever else is known, and the row says what
               * could not be asked. Anything else fails the row as before.
               */
              if (!mappedNow) throw error;
              askFailed = error instanceof Error ? error.message : String(error);
              logger.warn(
                `[refill] ${claim.awb}: account ${username} found, but the rest could not be asked — ${askFailed}`,
              );
            }
          }

          const values: RefillValues = local ?? { ...fromProbe, ...asked };

          /**
           * Asked, and nobody had it.
           *
           * NOT a failure: failure means something broke and is worth chasing —
           * a dead session, a relay that is down. This is an answer, and writing
           * nothing is the correct response to it. Reported with the resolver's
           * own words, which say what to do about it.
           */
          if (values.missing) {
            rows.push({
              cmsId: claim.cmsId,
              awbNumber: claim.awb,
              filled: {},
              kept: [],
              outcome: "not-found",
              message: values.missing,
            });

            continue;
          }

          // A corrected ticket number first — `/cms/update-ticket` moves the
          // row to In Review, so it has to land BEFORE the status below.
          await correctTicketNumber(token, claim.cmsId, doc, values.ticketNumber);

          const applied = await apiRequest<ApplyResponse>("/cms/refill-apply", {
            method: "POST",
            token,
            body: {
              cmsId: claim.cmsId,
              ...(fields.includes("accountMapping") ? { username } : {}),
              ...(values.subOrderNumber
                ? { subOrderNumber: values.subOrderNumber }
                : {}),
              ...(values.forwardAWB ? { forwardAWB: values.forwardAWB } : {}),
              ...(values.sellerSku ? { sellerSku: values.sellerSku } : {}),
              /**
               * THE PROBE'S POB WINS, and the order matters.
               *
               * `scoped.pobId` is only ever set when the account was asked of the
               * marketplace — which happens exactly when "Use APIs" is on. The
               * resolver's own answer comes from the local backup, and the whole
               * point of the toggle is to prefer the live one over it. With the
               * toggle off `scoped` is empty and the backup answers as before.
               */
              ...(scoped.pobId || values.pobId
                ? { pobId: scoped.pobId || values.pobId }
                : {}),
              ...(values.status ? { status: values.status } : {}),
              ...(values.compensationAmount !== null &&
              values.compensationAmount !== undefined
                ? { compensationAmount: values.compensationAmount }
                : {}),
              // Rides with the status like the amount does: the backend keeps it
              // only beside a Rejected verdict (TrackVid-BE utils/rejectReason).
              ...(values.status && values.rejectReason
                ? { rejectReason: values.rejectReason }
                : {}),
            },
          });

          if (!applied.success) throw new Error(applied.error.message);

          const wrote = applied.data.applied ?? {};
          const skipped = applied.data.skipped ?? [];
          const kept = skipped
            .filter((entry) => entry.reason.startsWith("Kept"))
            .map((entry) => ({
              field: entry.field,
              existing: entry.reason,
              fetched: entry.reason,
            }));

          /**
           * Why nothing was written, IN THE SERVER'S OWN WORDS when it gave any.
           *
           * "Already set to X" and "Kept X" are the ordinary answers and this
           * run has nothing to add to them. Anything else is the server
           * declining — a field it has no mapping for, a status it will not
           * touch — and reporting that as "the account is already what the
           * marketplace says" sends an operator to look at the marketplace for a
           * problem that is on this side. It is how a missing Tata CliQ account
           * field read as "1 unchanged" on a row with no account at all.
           */
          const refused = skipped.find(
            (entry) =>
              !entry.reason.startsWith("Kept") &&
              !entry.reason.startsWith("Already set"),
          );

          rows.push({
            cmsId: claim.cmsId,
            awbNumber: claim.awb,
            filled: wrote,
            kept,
            outcome:
              Object.keys(wrote).length > 0
                ? "filled"
                : refused
                  ? "failed"
                  : "nothing-to-do",
            message:
              Object.keys(wrote).length > 0
                ? Object.entries(wrote)
                    .map(([field, value]) => `${field} → ${value}`)
                    .join(", ") + (askFailed ? ` (the rest could not be asked: ${askFailed.slice(0, 120)})` : "")
                : refused
                  ? `Not written — ${refused.reason}`
                  : `Nothing to write — ${username} already has what the marketplace says`,
          });

          /*
           * STAMPED NOW, ROW BY ROW — not once at the end of the platform.
           *
           * A sweep of 580 claims takes the best part of an hour, and an app
           * closed at row 32 used to lose all 32: nothing had been written, so
           * the next run asked about every one of them again, and a machine
           * restarted often enough would never get past the front of the list.
           *
           * One small write per row is nothing beside the browser round trip
           * that produced the row, and it means progress survives whatever the
           * machine does next.
           *
           * STATUS PASS ONLY, upserted into `status-record` by AWB. Reaching
           * here means the marketplace was asked and answered — written,
           * nothing to write, or refused for a reason on this side — so the
           * AWB has been through the pass and waits CLAIM_STATUS_SYNC_DAYS. A
           * timeout lands in the catch below and is NOT stamped: it has told us
           * nothing.
           */
          if (!countsAttempt) {
            await rememberStatusSynced([
              { awb: claim.awb, cmsId: claim.cmsId, platform },
            ]);
          }

          // Answered. Leave the retry loop rather than falling to the break
          // below, which the catch also uses.
          break;
        } catch (error) {
          // One unreadable claim must not end the run: the rest are independent,
          // and a session that died is reported as itself rather than as "this
          // AWB is nobody's".
          const message =
            error instanceof Error ? error.message : String(error);

          logger.warn(`[refill] ${claim.awb}: ${message}`);

          /*
           * NOT THE ROW'S FAULT, so not the row's budget. The attempt was
           * charged before the ask — it has to be, because a row that crashes
           * the sweep must still be counted — so an ask the marketplace refused
           * is taken back off here.
           */
          if (countsAttempt && marketplaceDidNotAnswer(message)) {
            const charged = attemptedIds.lastIndexOf(claim.cmsId);

            if (charged !== -1) attemptedIds.splice(charged, 1);

            // One more go, after a pause, before it is written down as failed.
            if (attempt === 0) {
              logger.info(
                `[refill] ${claim.awb}: the marketplace refused to look — pausing and asking once more`,
              );

              continue;
            }

            logger.info(
              `[refill] ${claim.awb}: not charged — the marketplace did not answer, it refused to look`,
            );
          }

          rows.push({
            cmsId: claim.cmsId,
            awbNumber: claim.awb,
            filled: {},
            kept: [],
            outcome: "failed",
            message,
          });
        }

        // Either the row was answered or its one retry is spent; move on.
        break;
      }
    }
  } finally {
    await pool.closeAll();
    await closeRefillContexts(contexts);
    publish(null, false);
  }

  // ONE CALL FOR THE RUN, not one per row: a nightly sweep covers hundreds and
  // the count is bookkeeping. Best effort — losing an increment costs a row one
  // extra attempt, which is the cheaper way to be wrong.
  if (attemptedIds.length > 0) {
    const recorded = await apiRequest("/cms/refill-attempt", {
      method: "POST",
      token,
      body: { cmsIds: attemptedIds },
    });

    if (!recorded.success) {
      logger.warn(
        `[refill] could not record the attempt on ${attemptedIds.length} row(s): ${recorded.error.message}`,
      );
    }
  }

  const summary: RefillSummary = {
    platform,
    fields,
    total: claims.length,
    filled: counted("filled"),
    untouched: counted("nothing-to-do"),
    notFound: counted("not-found"),
    failed: counted("failed"),
    skipped: cappedIds.length,
    rows,
    shortcut,
  };

  logger.info(
    `[refill] ${platform}: ${summary.filled} filled, ${summary.untouched} unchanged, ` +
      `${summary.notFound} not found, ${summary.failed} failed, ${summary.skipped} past their ` +
      `refill limit, of ${claims.length}`,
  );

  // Best effort, and last: the values are already on the claims, and a run must
  // not fail over its own bookkeeping. Gated by JOB_RECORDING.
  await writeRefillJob({
    jobId,
    platform,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: "done",
    fields,
    accounts: accounts.map((account) => account.username),
    total: summary.total,
    filled: summary.filled,
    untouched: summary.untouched,
    notFound: summary.notFound,
    failed: summary.failed,
    shortcut,
    error: null,
    rows,
  });

  return ok(summary);
};

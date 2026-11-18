// -----------------------------------------------------------------------------
// AJIO POB sync — resolve the POB ids visible to one credential.
// -----------------------------------------------------------------------------
// Two AJIO endpoints answer this question, and which one works depends on what
// kind of seller account the credential is. Both are paged the same way (Spring
// Data: content / totalElements / totalPages / last) and both return one
// work-place record per POB, so only the request differs:
//
//   ENTERPRISE accounts (credential.IsEnterPriceLevel === true)
//     POST /malekith/nickfury/v1/pobsFromUserId/{userId}?page=N&size=20
//     body: { projections: [...] }
//
//   STANDARD accounts (the default — flag false or absent)
//     GET  /malekith/nickfury/v1/sellers/{userId}/work-places
//            ?workPlaceType=POB&page=N&size=5
//
// The flag is operator-set from the Monitor credentials panel; nothing in the
// AJIO login response reports which kind an account is, which is why this is
// read from the credential rather than probed. See the TrackVid-BE company
// model for the field, spelling included.
//
// Why in-page rather than a plain HTTPS request: AJIO sits behind Akamai, which
// rejects requests that do not come from a real browser context with the SPA's
// own headers and TLS fingerprint. Every other AJIO API call in this repo goes
// through page.evaluate for the same reason.
//
// NOTE ON FIELD CHOICE — read before "fixing" this.
// This collects `content[].id` — ONE ENTRY PER POB, from every page. It used to
// collect the distinct `parentId` instead, which is why a seller with five POBs
// stored a single id: every POB under one seller carries the same parentId, so
// the whole list collapsed to one. `parentId` is still gathered and returned
// alongside for diagnostics, but it is not what "the POB ids" means here.
//
// This is the same id space as ajioSession.pobIds (DV00349597, …) — the one
// downloadReport passes as the report filter and the x-pob-id header, and the
// one claimApiFlow.getPobRecord matches cms.pobid against. The two lists are
// now the same KIND of id, gathered at different times by different flows; they
// are still written to different fields and neither is a substitute for the
// other's freshness.
// -----------------------------------------------------------------------------

// AJIO's own UI requests this page size; keep it so the response shape matches
// what the portal itself receives.
const PAGE_SIZE = 20;

// The work-places endpoint is asked for 5 at a time because that is what the
// portal itself sends. Deliberately not raised to PAGE_SIZE: the "short page
// means last page" check below is only sound while the server honours the size
// we ask for, and a server-side cap would silently truncate the sweep.
const WORK_PLACES_PAGE_SIZE = 5;

// Runaway guard. 61 POBs over 20/page is 4 requests; 50 pages is 1000 POBs on
// the enterprise endpoint and 250 on work-places, both far past any real
// seller, so hitting it means the API stopped honouring `last` / `totalPages`
// and we should stop rather than loop forever.
const MAX_PAGES = 50;

// The projection list AJIO's own portal sends, plus `id` — the field this sync
// exists for. `id` is NOT in the portal's own list and the endpoint honours the
// projection, so leaving it out is what made the enterprise path fall back to
// the empty-string branch when reading `c.id`. The rest give the operator
// something recognisable to look at when the ids alone are meaningless.
const PROJECTIONS = [
  "id",
  "parentId",
  "storeName",
  "businessModel",
  "workPlaceType",
  "address",
  "userId",
  "integrationType",
  "fulfilmentType",
];

// The in-page fetches use a path relative to the SPA they run inside, so the
// origin is never sent. It is prefixed onto the log lines only, so what the
// terminal prints is a URL you can paste into curl rather than a fragment.
const ORIGIN = "https://seller.ajio.com";

/** Request path for the enterprise endpoint (POST, projections in the body). */
const pobPageUrl = (userId, pageNum) =>
  `/malekith/nickfury/v1/pobsFromUserId/${encodeURIComponent(userId)}` +
  `?page=${pageNum}&size=${PAGE_SIZE}`;

/** Request path for the standard endpoint (GET, everything in the query). */
const workPlacesPageUrl = (userId, pageNum) =>
  `/malekith/nickfury/v1/sellers/${encodeURIComponent(userId)}/work-places` +
  `?workPlaceType=POB&page=${pageNum}&size=${WORK_PLACES_PAGE_SIZE}`;

/**
 * Fetch one page of POBs from inside the page context.
 * Returns { status, json | null, text } — never throws for HTTP errors, so the
 * caller decides whether a mid-pagination failure is fatal.
 *
 * Takes the URL already built rather than building it here: the pager logs the
 * exact string it is about to request, and a log line assembled separately from
 * the request is a log line that can drift from it.
 */
async function fetchPobPage(page, url) {
  return page.evaluate(
    async (u, projections) => {
      try {
        const r = await fetch(u, {
          method: "POST",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "X-Tenant": "AJIO",
          },
          credentials: "include",
          body: JSON.stringify({ projections }),
        });
        const text = await r.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (_) {
          /* non-JSON body — surfaced through `text` below */
        }
        return { status: r.status, json, text: text.slice(0, 2000) };
      } catch (e) {
        return { status: -1, json: null, text: String(e) };
      }
    },
    url,
    PROJECTIONS,
  );
}

/**
 * Fetch one page of work-places (the standard-account endpoint).
 * Same return contract as fetchPobPage — { status, json | null, text }, never
 * throwing on an HTTP error — so the pager below treats the two identically.
 *
 * A GET with no body: the projection list the enterprise endpoint takes has no
 * equivalent here, the response is the full work-place record either way, and
 * `parentId` is on it.
 */
async function fetchWorkPlacesPage(page, url) {
  return page.evaluate(async (u) => {
    try {
      const r = await fetch(u, {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*",
          "X-Tenant": "AJIO",
        },
        credentials: "include",
      });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {
        /* non-JSON body — surfaced through `text` below */
      }
      return { status: r.status, json, text: text.slice(0, 2000) };
    } catch (e) {
      return { status: -1, json: null, text: String(e) };
    }
  }, url);
}

/**
 * Page through whichever POB endpoint this credential is entitled to and
 * collect every POB id, one per record returned.
 *
 * @param {object} page      Puppeteer page already carrying the AJIO session
 * @param {string} userId    Seller userId from the cached session
 * @param {object} [opts]
 * @param {boolean} [opts.enterpriseLevel=false]  credential.IsEnterPriceLevel —
 *        true routes to pobsFromUserId, false (the default) to work-places.
 * @returns {Promise<{ pobIds: string[], parentIds: string[], stores: Array<{id,parentId,storeName}>, totalElements: number|null, source: string }>}
 */
async function syncPobIds(page, userId, { enterpriseLevel = false, logger = console } = {}) {
  if (!userId) throw new Error("syncPobIds requires a userId");

  // Strict true: absent / null / "false" all mean a standard account, which is
  // what every credential written before the flag existed is.
  const useEnterpriseApi = enterpriseLevel === true;
  const fetchPage = useEnterpriseApi ? fetchPobPage : fetchWorkPlacesPage;
  const buildUrl = useEnterpriseApi ? pobPageUrl : workPlacesPageUrl;
  const pageSize = useEnterpriseApi ? PAGE_SIZE : WORK_PLACES_PAGE_SIZE;
  const method = useEnterpriseApi ? "POST" : "GET";
  const source = useEnterpriseApi ? "pobsFromUserId" : "work-places";

  // The raw stored value, not the coerced boolean: when the routing is wrong
  // the useful thing to see in the terminal is what was actually on the
  // credential (undefined, "false", 0) rather than what it collapsed to.
  logger.log?.(
    `🔎 [ajio/pobSync] IsEnterPriceLevel=${JSON.stringify(enterpriseLevel)} → ` +
      `${useEnterpriseApi ? "ENTERPRISE" : "STANDARD"} endpoint (${source}), userId=${userId}`,
  );

  const seenPobs = new Set();
  const seenParents = new Set();
  const pobIds = [];
  const parentIds = [];
  const stores = [];
  let totalElements = null;

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const url = buildUrl(userId, pageNum);

    logger.log?.(`🌐 [ajio/pobSync] ${method} ${ORIGIN}${url}`);

    const res = await fetchPage(page, url);

    logger.log?.(
      `   ↳ HTTP ${res.status}` +
        (res.json && typeof res.json.totalElements === "number"
          ? ` · totalElements=${res.json.totalElements}`
          : ""),
    );

    if (res.status < 200 || res.status >= 300) {
      // Page 0 failing means we have nothing at all — that is an error worth
      // reporting. A later page failing after we already have results is not:
      // returning the partial set beats discarding a good first page, and the
      // count in the response tells the operator it was partial.
      //
      // The endpoint name is in the message because the likeliest cause of a
      // 403 here is the account being on the other side of the enterprise flag.
      if (pageNum === 0) {
        throw new Error(
          `${source} failed: status=${res.status} body=${String(res.text).slice(0, 200)}`,
        );
      }
      logger.warn?.(
        `⚠️ [ajio/pobSync] ${source} page ${pageNum} failed (status=${res.status}) — returning ${pobIds.length} POB id(s) found so far`,
      );
      break;
    }

    if (!res.json) {
      if (pageNum === 0) {
        throw new Error(
          `${source} returned a non-JSON body: ${String(res.text).slice(0, 200)}`,
        );
      }
      break;
    }

    const content = Array.isArray(res.json.content) ? res.json.content : [];
    if (typeof res.json.totalElements === "number") totalElements = res.json.totalElements;

    for (const c of content) {
      if (!c) continue;
      const pobId = String(c.id || "").trim();
      const parentId = String(c.parentId || "").trim();

      // One id per record. The Set only guards against the same record arriving
      // twice across pages (AJIO pages by offset, so a POB added mid-sweep can
      // shift one onto a page already read) — it is NOT collapsing distinct
      // POBs, which is what the old parentId-based dedupe was doing.
      if (pobId && !seenPobs.has(pobId)) {
        seenPobs.add(pobId);
        pobIds.push(pobId);
      }

      // Every POB under one seller carries the same parentId, so this list is
      // normally one entry. Carried for diagnostics only — it is what this sync
      // used to store, and seeing it makes an unexpected result explainable.
      if (parentId && !seenParents.has(parentId)) {
        seenParents.add(parentId);
        parentIds.push(parentId);
      }

      stores.push({
        id: pobId,
        parentId,
        storeName: String(c.storeName || "").trim(),
      });
    }

    // Stop on any signal the API gives us that this was the last page. Checking
    // all three (rather than trusting `last` alone) is what keeps a missing or
    // renamed field from turning into MAX_PAGES wasted round-trips.
    const isLast =
      res.json.last === true ||
      content.length < pageSize ||
      res.json.totalPages == null ||
      pageNum >= res.json.totalPages - 1;
    if (isLast) break;
  }

  // Read from a page of terminal output, the useful comparison is ids-found
  // against the count AJIO itself reported: a gap means the sweep stopped
  // early, which no amount of staring at the id list would reveal.
  logger.log?.(
    `📦 [ajio/pobSync] ${pobIds.length} POB id(s)` +
      (totalElements != null ? ` of ${totalElements} reported` : "") +
      ` across ${stores.length} record(s)` +
      (parentIds.length ? ` · parentId(s): ${parentIds.join(", ")}` : ""),
  );

  // `source` rides back with the ids so the caller can log and report which of
  // the two endpoints actually answered — otherwise an account on the wrong
  // side of the enterprise flag looks identical to one AJIO has no POBs for.
  return { pobIds, parentIds, stores, totalElements, source };
}

module.exports = {
  syncPobIds,
  PAGE_SIZE,
  WORK_PLACES_PAGE_SIZE,
  PROJECTIONS,
};

# Flipkart SPF claims — API guide

How the API-based Flipkart claim flow talks to Flipkart Seller Hub, call by call,
and what to change when Flipkart changes something.

- **Code:** [`claimApiFlow.js`](./claimApiFlow.js) (one function per Flipkart call) and
  [`fileClaim.js`](./fileClaim.js) (the steps for one AWB).
- **Shapes:** [`flipkartApiTypes.js`](./flipkartApiTypes.js) (JSDoc typedefs for every
  request and response below).
- **Source of truth:** captures of the real portal. The last one was made on
  2026-09-15 with Chrome 152: login with OTP, file a claim, search the ticket,
  run a global AWB search. Nothing here is guessed unless it says **unverified**.

> Captures contain live session cookies, csrf tokens and passwords. Never commit
> one, never paste values from one into code or into this file, and sign that
> Flipkart session out once you've finished reading the capture.

---

## 1. Who calls this

| Runner | Entry point | What it uses |
|---|---|---|
| Automated-Scripts (server) | `src/platforms/flipkart/claim-management/api-based-flow/apiScriptNew.js` | `loginFlipkartApi`, `getProductTypes`, `fileFlipkartClaim` |
| Automated-Scripts (server) | `src/platforms/flipkart/common/statusSyncService.js` | `findClaim`, `getOrderSearch`, `approvedAmountOf` |
| Automated-Scripts (server) | `src/platforms/flipkart/common/orphanClaimService.js` | `getOrderSearch` |
| Core | `platforms/flipkart/account-mapping/api-based-flow/probeAwb.js` | `getOrderSearch` |
| Trackvid-CMS (desktop) | `electron/main/automations/platforms/flipkart/claim-management/api-based-flow/runClaim.ts` | `loginFlipkartApi`, `getProductTypes`, `fileFlipkartClaim` |
| TrackVid-BE | `POST /api/cms/flipkart-status-sync` → `syncFlipkartClaimStatuses` (`src/controllers/CMS/cms.controller.ts`) | receives status + `approvedAmount` |

A change in this folder reaches **both** runners. Follow the core's `CLAUDE.md`
checks before you ship it.

---

## 2. The flow, end to end

```
LOGIN (Selenium)       GET  /getStateDetails
                       POST /login            { authName:"flipkart", username, password, userNameType:"email" } → { mfa }
                       POST /verifyOtp        { otp }  → data.sellerId, data.userId, …
                       cookies + csrf harvested, browser closed

PER AWB (fileFlipkartClaim)
 1  NAPI  Payments_SPF_WEB_getOrderSearch      query = AWB
          ├─ no item      → returns_searchReturnItem → NOT_CLAIM_ELIGIBLE (on account) / NO_RETURN_PACKETS (not on account)
          ├─ claim exists → findClaim → return { alreadyExisted, status, approvedAmount }
          └─ not eligible → SPF_WINDOW_EXPIRED / NOT_CLAIM_ELIGIBLE
    NAPI  returns_searchReturnItem             searchBy tracking_id — does this AWB belong to this account?
 2  NAPI  Payments_SPF_WEB_getProductTypes     (once per batch)
    NAPI  Payments_SPF_WEB_getIssueTypes       (once per product type)
 3  POST  /napi/payments-rest/uploadSpfClaimFile   shipping label + every evidence image
 4  NAPI  Payments_SPF_WEB_createclaimV2       ← the only irreversible call
 5  ORCH  GetSpfClaimCountsOrchestrator        searchText = AWB → which state tab
    ORCH  GetSpfClaimsOrchestrator             that tab, search by tracking_id → claimId
          (fallbacks: PROCESSING tab directly, then getOrderSearch.claim_details)

STATUS SYNC (statusSyncService, before each batch)
    per open CMS row: findClaim(AWB) → status (+ approvedAmount when APPROVED)
                      fallback getOrderSearch → claim_status / claim_id
    one POST to TrackVid-BE /api/cms/flipkart-status-sync
```

---

## 3. Authentication

### Login

`loginFlipkartApi(credentials, { maxAttempts, forceFresh })` in `claimApiFlow.js`.

1. Reuse a stored session if `getUsableSession` has one (`../../common/sessionStore`).
2. Otherwise drive the login in Selenium (`../common/utils` → `flipkartLogin`):
   `/getStateDetails` → `/login` (answers `{ mfa }`, meaning an OTP was emailed) →
   OTP read from the mailbox → `/verifyOtp`.
3. Copy every browser cookie into `ctx.jar`, then find the csrf token.
4. Save the session and close the browser. Everything after this is plain HTTP (axios).

An OTP-stuck login is retried with a fresh browser (`maxAttempts`, default 2).

### CSRF token

`fk-csrf-token` is a **double-submit** token: the header value must equal the
value of cookie **`XyZ7pQ9rS2T1uV8wA3bC6dE4fG0h`**. If they differ, Flipkart answers
`403 EBADCSRFTOKEN` ("Your session seems out of sync") on every call.

`discoverCsrfToken` checks, in this order: `FLIPKART_CSRF_COOKIE_NAME`, the known
cookie name, any cookie whose name contains `csrf`, a value shaped like
`xxxxxxxx-yyyyyyyyyyyyyyyyyyyyyyyy` (analytics cookies excluded), then page
storage. If Flipkart renames the cookie, set `FLIPKART_CSRF_COOKIE_NAME`.

### Session expiry

HTTP 401/403 throws `authError` (`err.code === "AUTH_EXPIRED"`). The runners log
in again once and retry the AWB. `fileClaim.js` never swallows `AUTH_EXPIRED`,
not even inside best-effort lookups.

---

## 4. Common request headers

Every GraphQL call (`gqlHeaders`):

| Header | Value | Notes |
|---|---|---|
| `user-agent` | Chrome 152 macOS UA | Keep in step with the client hints |
| `sec-ch-ua*` | copied from the capture (`CLIENT_HINTS`) | Flipkart's bot layer reads them |
| `content-type` | `application/json` | |
| `Referer` | `https://seller.flipkart.com/index.html` | |
| `fk-csrf-token` | `ctx.csrfToken` | see §3 |
| `operation` | `query` or `mutation` | the gateway routes on it |
| `operation-name` | the GraphQL `operationName` | the gateway routes on it |
| `x-internal-env-type` | `WEB` | |
| `x-location-id` | `ctx.locationId` → `FLIPKART_LOCATION_ID` → `""` | **unverified source**, see below |
| `x-requested-with` | `XMLHttpRequest` | |
| `cookie` | the whole jar | |

**Orchestrator calls only** (`/orchestrator/graphql`): `x-client-id: SD`,
`x-seller-id: <sellerId>`, `x-user-id: <sellerId>`. Both ids carry the **seller
id** (confirmed in the capture); it is not the `ACC…` userId from `/verifyOtp`.
`ctx.sellerId` is filled by the first `getOrderSearch` call. `ensureSellerId` runs
that call first when a restored session has no seller id.

**`x-location-id`:** the portal sends `LOC` + 32 hex chars. That value does not
appear in any captured response or cookie, and every call has worked with an
empty value. If Flipkart starts requiring it, find where the page reads it
(localStorage or a bootstrap call) and put it on `ctx.locationId`.

### Errors

- GraphQL errors come back as **HTTP 200** with `errors[]` (napi) or
  `graphErrors[]` (orchestrator). `gqlError` turns them into
  `err.code = "FLIPKART_API_ERROR"`.
- Orchestrator responses also carry `dataErrors: {}` and `isDataPresent: true`.
  Neither is treated as an error.
- **Queries** are retried twice on timeouts and 408/429/5xx (`isTransient`),
  including Flipkart's `"Request Timed Out"` inside a 200. **Mutations are never
  retried**: a timed-out `createClaimV2` may already have filed the claim.
- Every failed call is logged by `logApiFailure` (`common/apiResponseLogger`).

---

## 5. Operations

Endpoints: `NAPI = https://seller.flipkart.com/napi/graphql`,
`ORCH = https://seller.flipkart.com/orchestrator/graphql`.
Body is always `{ operationName, variables, query }`.

### 5.1 `Payments_SPF_WEB_getOrderSearch` — NAPI query

**Function:** `getOrderSearch(ctx, trackingId)` → `{ found, item, claimId }`
**Used for:** finding the return line item to claim, spotting an existing claim,
and caching `ctx.sellerId`.

```json
{ "query": "<AWB>" }
```

```json
{ "data": { "getOrderSearch": {
  "return_item_list": [{
    "order_id": "OD…", "order_item_id": "…", "return_id": "…",
    "tracking_id": "<AWB>", "seller_id": "…",
    "claim_eligible": true, "claim_eligible_reason": null,
    "claim_details": null,
    "eligible_quantity": 1, "quantity": 1, "shipment_expectation": "expect",
    "status": "completed", "shipment_status": "delivered", "type": "customer_return", …
  }],
  "has_more": false, "next_page": null } } }
```

Once a claim is filed, the same search returns `claim_eligible: false`,
`eligible_quantity: 0` and
`claim_details: { claim_id, incident_id, claim_status: "OPEN", claim_amount: null }`.
`claim_status` never says approved or rejected, so use §5.7 for that.

An empty `return_item_list` means the AWB is not SPF-claimable on this login.
§5.8 tells you why.

### 5.2 `Payments_SPF_WEB_getProductTypes` — NAPI query

**Function:** `getProductTypes(ctx)` → `string[]`. No variables.
Response: `getProductTypes.product_type = ["Main Product", "Packaging", "Accessory", "Freebie", "Combo product"]`.

### 5.3 `Payments_SPF_WEB_getIssueTypes` — NAPI query

**Function:** `getIssueTypes(ctx, productType)` → `string[]`.

```graphql
query Payments_SPF_WEB_getIssueTypes($productType: String!) { … }
```

`$productType` is **`String!`**, exactly as the portal declares it. Variables:
`{ "productType": "Main Product" }`. The response keys lists by product type with
spaces turned into underscores (`Main_Product`). Only the requested key is filled
in; the rest are `null`.

The CMS row's `issueArea` (product type) and `issueType` are checked against
these lists by `resolveFromVocabulary`. The check ignores case and punctuation.

### 5.4 `uploadSpfClaimFile` — multipart POST

**Function:** `uploadSpfClaimFile(ctx, filePath, displayName)` → `{ name, path }`
`POST https://seller.flipkart.com/napi/payments-rest/uploadSpfClaimFile`

- Headers: `FK-CSRF-TOKEN`, `X-LOCATION-ID`, UA and client hints, cookie. There is
  no `operation` header.
- Form field `file` (**unverified**: the capture does not include binary bodies.
  Override with `FLIPKART_UPLOAD_FIELD`).
- The multipart **filename must end in** `.jpg .jpeg .png .bmp`. Flipkart checks
  the extension separately from the content type.
- Response: `{ "url": "/attachments/BN:…:<uuid>" }`. That `url` becomes the
  attachment `path`.

### 5.5 `Payments_SPF_WEB_createclaimV2` — NAPI mutation

**Function:** `createClaimV2(ctx, variables)`. Guarded by `assertClaimSubmitEnabled`
(`DESABLE_SAVE=true` stops here).

```json
{
  "order_id": "OD…", "order_item_id": "…", "return_id": "…",
  "shipment_expectation": "expect", "quantity_affected": 1,
  "product_type": "Main Product", "issue_type": "I received a wrong product",
  "description": "…",
  "attachments": [
    { "name": "shipping-label", "path": "/attachments/…" },
    { "name": "evidence_1.png", "path": "/attachments/…" }
  ]
}
```

Response: `createClaimV2: { claim_id: null, incident_id: null, state: null }`.
**All three are null even when the claim was filed.** The id is read back in step 5.
If the readback finds nothing, the AWB is reported as `TICKET_READBACK_FAILED`
(CMS script status "Help Center Failed"), **never** as Failed. A Failed AWB
gets filed again, which creates a duplicate claim.

### 5.6 `GetSpfClaimCountsOrchestrator` — ORCH query

**Function:** `getClaimStateCounts(ctx, searchText)` → `{ total, stateCounts, autoProcessedClaims }`
This is step 1 of the portal's ticket search.

```json
{ "input": { "searchText": "<AWB>" } }
```

```json
{ "data": { "claim": {
  "sellerClaims": { "total": 1, "stateCounts": [{ "state": "PROCESSING", "count": 1 }] },
  "autoProcessedClaims": [] } },
  "dataErrors": {}, "graphErrors": [], "isDataPresent": true }
```

With `searchText: null` you get the account's totals. The states seen are
`SELLER_PENDING`, `PROCESSING`, `APPROVED`, `AUTO_CLOSE` and `REJECTED`, and
`autoProcessedClaims` has entries like `{ source: "SHIPMENT_LOST_CLAIMS", count }`.
An AWB with no claim returns an empty `stateCounts`.

### 5.7 `GetSpfClaimsOrchestrator` — ORCH query

**Function:** `getSpfClaims(ctx, { search, searchOption, status, pageSize, startingPage })`
This is step 2 of the portal's ticket search. It takes **one state per call**.

```json
{ "input": {
  "filter": { "search": "<AWB>", "searchOption": "tracking_id", "status": "APPROVED" },
  "pagination": { "pageSize": 10, "startingPage": 1, "sort": null } } }
```

```json
{ "data": { "claims": { "hasMore": false, "nextUrl": null, "claims": [{
  "claimId": "2026…", "incidentId": "IN26…", "status": "APPROVED",
  "approvedAmount": 622.68, "settlementAmount": 841,
  "orderId": "OD…", "orderItemId": "…", "returnId": "…", "trackingId": "<AWB>",
  "createdAt": "2026-09-15 10:56:26.0", "updatedAt": "…",
  "sku": "…", "productDetails": "…", "productPrice": 0, "totalPrice": 0,
  "quantityApproved": null, "quantityClaimed": null, "sellerRequestedQuantity": 1, …
}] } } }
```

- `approvedAmount` is the approved payout **only when `status` is `APPROVED`**.
  Other tabs report `0`.
- Older claims come back with `trackingId: null`.

**`findClaim(ctx, trackingId, { claimId, orderItemId, returnId })`** combines
§5.6 and §5.7:

1. Get the counts, keeping only states with `count > 0`. If none are left, return `null`.
2. Search each of those states by `tracking_id`.
3. Keep a row only if it matches (`matchesClaim`): same `claimId`, or same
   `trackingId`, or (when `trackingId` is null) same `orderItemId` / `returnId`.
   Never accept an unmatched row.
4. A row matching the known `claimId` wins. Otherwise the newest `createdAt` wins.
5. Returns a `FoundClaim` (`claimId, incidentId, status, approvedAmount, …, raw`).

`getClaimIdFromProcessing(ctx, trackingId, { status })` is the older single-tab
lookup. It is still used as a readback fallback.

### 5.8 `returns_searchReturnItem` — NAPI query (global AWB search)

**Function:** `searchReturnItem(ctx, searchValue, { searchBy })` → `{ found, returns[] }`
This is the Returns page's search box. The session belongs to one account, so a
hit means the AWB is on this account.

```json
{ "searchBy": "tracking_id", "searchValue": "<AWB>" }
```

`searchBy` can also be `"order_item_id"`. The portal uses that one for flyer and
proof-of-delivery details.

```json
{ "data": { "data": { "timeStamp": "2026-09-15/10:58:47", "response": [{
  "tracking_id": { "trackingId": "<AWB>" },
  "order_id": { "orderId": "OD…", "orderItemIds": ["…"] },
  "return_type": { "returnType": "customer_return", "returnId": "…" },
  "return_status": { "status": "completed", "shipmentStatus": "delivered" },
  "data": { "return_status_text": "Return Delivered", "location_id": "LOC…", … },
  "product": [{ "order_item_id": "…", "sku": "…", "title": "…", … }] }] } } }
```

The captured query asks for about 80 fields. `Q_SEARCH_RETURN_ITEM` asks only
for the fields that get read, which is valid GraphQL.

**Unverified:** what Flipkart returns for an AWB it doesn't know. An empty or
`null` `response` counts as not found, and so does a GraphQL error saying "not
found" or "no data". Any other error is thrown.

How `fileClaim.js` uses it:

- **Before any download, upload or filing** (`assertReturnBelongsToAccount`): if the search finds
  the AWB under a **different** order item, it throws `ACCOUNT_MISMATCH` and the
  claim is not filed. An empty or failed search only logs a warning, because
  the order search already found the item on this session.
- **When getOrderSearch finds nothing** (`notFoundError`): if the return is on
  the account, it throws `NOT_CLAIM_ELIGIBLE: … lists no SPF claim option`.
  Otherwise it throws `NO_RETURN_PACKETS: Wrong awb number, Not exist in account <username>`.

---

## 6. Status and amount → TrackVid

### Flipkart state → CMS

| Flipkart | `claimStatusToCmsStatus` (core, filing result) | `FLIPKART_TO_CMS_STATUS` (status sync) |
|---|---|---|
| `OPEN` | Success | In Review |
| `PROCESSING` | Success | In Review |
| `SELLER_PENDING` | Success | Awaiting Seller Response |
| `APPROVED` | Approved | Approved |
| `REJECTED` | Rejected | Rejected |
| `AUTO_CLOSE` | Success (default) | *not mapped*: only the check date is stamped |

`AUTO_CLOSE` is left unmapped on purpose. Nobody has confirmed whether a claim
closed that way was paid. Once someone confirms it, add it to both tables.

### Approved amount

1. `findClaim` reads `approvedAmount`. `approvedAmountOf(claim)` returns it only
   when `status === "APPROVED"`.
2. The status sync (and a batch that runs into an already-approved claim) sends
   `{ cmsId, status: "Approved", flipkartStatus: "APPROVED", approvedAmount: 622.68 }`
   to `POST /api/cms/flipkart-status-sync`.
3. `syncFlipkartClaimStatuses` writes **`compensationAmount`** on the CMS claim,
   but only when that item's status is `Approved` and the amount is a finite
   number ≥ 0. This is the same field Myntra's payout sync writes.

---

## 7. Environment variables

| Variable | Effect |
|---|---|
| `FLIPKART_API_DEBUG=true` | verbose `[flipkart-spf]` logging |
| `FLIPKART_SPF_TIMEOUT_MS` | per-request timeout (default 60000) |
| `FLIPKART_CSRF_COOKIE_NAME` | cookie that holds the csrf token |
| `FLIPKART_UPLOAD_FIELD` | multipart field name for uploads (default `file`) |
| `FLIPKART_LOCATION_ID` | value for `x-location-id` (default empty) |
| `DESABLE_SAVE=true` | everything runs except `createClaimV2` |
| `FLIPKART_REPORT_STATUS_CHANGE_PROCESS=true` | enables the status sync (Automated-Scripts) |
| `FLIPKART_STATUS_RECHECK_DAYS` / `FLIPKART_STATUS_MAX_PER_ACCOUNT` | status sync throttle and cap |

---

## 8. When an API breaks

1. **Read the failure line.** `logApiFailure` prints the step name (e.g.
   `SPF claims lookup (APPROVED)`), the HTTP status and the response body. The
   step name tells you which function in §5 to look at.
2. **Classify it.**
   - `403 EBADCSRFTOKEN`: csrf cookie renamed → `FLIPKART_CSRF_COOKIE_NAME`, then `CSRF_COOKIE_NAME`.
   - `401/403` otherwise: session dead. Re-capture the session, then check `/verifyOtp` still returns `sellerId`.
   - `200/GraphQL` with `Cannot query field "x"`: a field was removed. Delete it from the query and the typedef.
   - `200/GraphQL` with `Variable "$x" of type … used in position expecting …`: a variable type changed (as `$productType: String!` did). Copy the portal's declaration.
   - Empty results for an AWB the portal can see: compare variables and headers (`x-seller-id`, `searchOption`, `status`) with a fresh capture.
   - HTML or 4xx from the edge: UA and client hints are out of date. Copy them from a fresh capture.
3. **Record the portal doing it by hand.** Log in, open SPF Claims, raise or
   search the claim, and export the network log. Compare for each operation:
   `operation-name`, the `query` text, `variables`, and the orchestrator headers.
4. **Change the query string in `claimApiFlow.js`**, the typedef in
   `flipkartApiTypes.js`, and this file together. The query decides which fields
   exist at runtime. The typedef is what TypeScript and editors see.
5. **Check it.** From the core: `npm run build`. Then boot Automated-Scripts
   (`node server.js`), run `npm run verify` in Trackvid-CMS (which includes
   `tests/flipkartClaimLookup.test.ts`), and run `tsc` in TrackVid-BE if the
   sync payload changed. Copy the changed core files to the other consumer's
   core checkout so both stay identical.
6. **Delete the capture** and sign that Flipkart session out.

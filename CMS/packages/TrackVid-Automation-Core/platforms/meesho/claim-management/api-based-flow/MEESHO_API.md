# Meesho claims — API guide

How the API-based Meesho claim flow talks to the supplier panel, call by call,
and what to change when Meesho changes something.

- **Code:** [`claimApiFlow.js`](./claimApiFlow.js) (one function per Meesho call) and
  [`fileClaim.js`](./fileClaim.js) (the steps for one AWB).
- **Shapes:** [`meeshoApiTypes.js`](./meeshoApiTypes.js) (JSDoc typedefs for every
  request and response below).
- **Source of truth:** a capture of the real portal, Chrome 152, 2026-09-16:
  login, the Returns search, the support form, four attachment uploads, a
  refused claim and a ticket search. Nothing here is guessed unless it says
  **unverified**.

> Captures contain live session cookies and passwords. Never commit one, never
> paste values from one into code or into this file, and sign that Meesho
> session out once you've finished reading it.

---

## 1. Who calls this

| Runner | Entry point | What it uses |
|---|---|---|
| Automated-Scripts (server) | `src/platforms/meesho/claim-management/api-based-flow/apiScriptNew.js` | `loginMeeshoApi`, `fileMeeshoClaim` |
| Automated-Scripts (server) | `src/platforms/meesho/common/statusSyncService.js` | `searchTicketsBySubOrder`, `mapMeeshoStatus` |
| Core | `platforms/meesho/account-mapping/api-based-flow/probeAwb.js` | its own copy of the Returns search |
| Trackvid-CMS (desktop) | `electron/main/automations/platforms/meesho/claim-management/api-based-flow/runClaim.ts` | `loginMeeshoApi`, `fileMeeshoClaim` |
| Trackvid-CMS (desktop) | `electron/main/automations/platforms/meesho/claim-management/common/tatCheck.ts` | `validateTicketField`, `tatVerdict`, `searchReturnClaims` |

A change in this folder reaches **both** runners. Follow the core's `CLAUDE.md`
checks before you ship it.

---

## 2. The flow, end to end

```
LOGIN (Puppeteer)   POST /api/container/user/v2-login                  { email, password, device_id, instance }
                    POST /api/container/supplier/prefetch-supply-data   → supplier_id + identifier (the ONLY source)
                    cookies harvested, browser closed

PER AWB (fileMeeshoClaim)
 1  POST /api/fulfillment/returnRto/fetchReturnClaims   AWB → is it on this account? sub_order_num, delivered date
 1b POST /api/experience/support/searchTickets          already filed for this sub-order? → stop, report that ticket
 2  POST /api/experience/support/api/v1/upload/…/input-attachment   one call per file → GCS URL
 3  POST /api/experience/support/fetchSubCategory       claim type → sub_category_id
 4  POST /api/experience/support/createTicket           ← the only irreversible call; returns ticket_id
 5  POST /api/experience/support/searchTickets          fallback when the submit returned no id

CHECK TAT (operator-run, NOT part of filing — Trackvid-CMS "Check TAT")
    POST /api/experience/support/validateTicketField    sub-order + AWB → is_valid / errors[]
    a window message → the claim moves to Failed to Proceed with "TAT Expired"
```

---

## 3. Authentication

`loginMeeshoApi(credentials, { forceFresh })`:

1. Reuse a stored session if `getUsableSession` has one (`../../common/sessionStore`).
2. Otherwise drive the two-step email+password form in Puppeteer. Meesho keeps
   you on `/login` when the credentials are wrong — that is how failure is
   detected (`INVALID_CREDENTIALS`).
3. Harvest the cookies, then read `supplier_id` and `identifier` from
   `POST /api/container/supplier/prefetch-supply-data` inside the signed-in page
   (`platforms/meesho/common/supplierIdentity.js`, shared with the desktop
   app's capture). **Not** `supplier/api/2.0/supplier/config` — that response is
   the feature-flag blob and carries no ids, which is what made every stored
   session look incomplete and cost a second sign-in.
4. Save the session and close the browser. Everything after this is plain HTTP.

**A session is cookies + two ids**: `supplierId` (numeric, in the body of most
calls) and `supplierIdentifier` (the 5-character slug, the `identifier` header
on every call). Missing the slug answers
`403 {"errorCode":1001,"message":"Identifier not present or invalid"}`, which
reads exactly like an expired session and is not one. A stored session that has
cookies but no ids repairs itself: `ensureSupplierIdentity` asks
prefetch-supply-data once per context, with no browser.

**There is no token.** The session is the cookies; no call carries an
`Authorization` header. 401/403 throws `authError` (`err.code = "AUTH_EXPIRED"`)
and the runners sign in again once.

The desktop app captures its own session in an Electron window and reads the
same two ids through `common/sessionExtras.js`, so a captured session is
complete enough to file with — see that file for why that matters.

---

## 4. Common request headers

Meesho answers before it looks at the session when these are missing. Verified
against the live endpoint with **no cookies**:

| Headers sent | Answer |
|---|---|
| none | **403 "Access Denied"** — Akamai, before Meesho sees it |
| `user-agent` only | 400 `{"message":"Bad Request. Invalid client type."}` |
| `user-agent` + `client-type: d-web` | 463 `{"message":"Unauthorized call. Token missing."}` |

Only the last is Meesho reading the request. So every call sends:

| Header | Value |
|---|---|
| `user-agent` | a real Chrome UA |
| `accept` | `application/json, text/plain, */*` |
| `content-type` | `application/json` (`;charset=UTF-8` on the support calls) |
| `origin` / `Referer` | `https://supplier.meesho.com` + the SPA route |
| `client-type` | `d-web` |
| `client-package-version` | **per module**, see below |
| `identifier` | the supplier slug (`ctx.supplierIdentifier`) |
| `cookie` | the whole jar |

**`client-package-version` differs by area** (both from the capture):

| Path prefix | Version |
|---|---|
| `/api/experience/support/*` | `1.2.3` |
| `/api/fulfillment/returnRto/*` | `1.0.4` |
| `/api/container/*`, `/api/growth/*` | `1.0.39` (not used by this flow) |

**`browser-id`** is on every captured request — a per-browser fingerprint. It is
deliberately **not** invented here; there is no honest value for it. If Meesho
starts requiring it, that is the first thing to add.

**The supplier id is spelled differently per endpoint** and the difference is
real: `supplier_id` as a **number** in searchTickets/subcategorySchema/
fetchSubCategory, as a **string** in validateTicketField/createTicket, and as
`supplier_details.id` in the Returns search.

### Errors

- **A refusal is an HTTP 200.** `createTicket`, `validateTicketField` and the
  upload all answer `{ is_valid: false, errors: [{ field_name, error_message }] }`
  with a 200. Reading only the status treats a refused claim as filed.
- 301/302 to a login page is a dead session, and is thrown as `AUTH_EXPIRED`.
- Every failed call is logged by `logApiFailure` (`common/apiResponseLogger`).

---

## 5. Operations

Base: `https://supplier.meesho.com`.

### 5.1 `POST /api/fulfillment/returnRto/fetchReturnClaims` — global AWB search

**Function:** `searchReturnClaims(ctx, awbNumber)` → `{ found, returns[] }`
**Used for:** is this AWB on this account, and what is its sub-order number.

```json
{ "screenType": "returns", "size": 50,
  "page_pointer": null, "cursor": null, "filter_cursor": null,
  "filters": { "shipment_status": "search_return_rto", "text_global": "<AWB>" },
  "supplier_details": { "identifier": "<slug>", "id": <supplierId> },
  "identifier": "<slug>", "child_supplier_identifier": null, "child_supplier_id": null }
```

`filters.shipment_status` must be `search_return_rto`. Any other tab scopes the
search elsewhere and answers empty.

```json
{ "data": [{
    "awb": "<AWB>", "order_num": "…", "sub_order_num": "…_1",
    "sub_order_identifier": "…_1_return_919569291",
    "type": "RET", "sub_type": "FIRST_RET", "shipment_status": "Delivered",
    "created_date_iso": "2026-08-30T15:48:09+0530",
    "delivered_date_iso": "2026-09-06T17:26:42+0530",
    "carrier_name": "Delhivery",
    "return_reason_details": { "return_reason": "…", "detailed_reason": "…" },
    "product": { "name": "…", "sku": "…", "quantity": 1, "image_urls": ["…"] },
    "proof_of_delivery": { … } }],
  "count": { "search_return_rto": 1, "completed": 223, … },
  "total_pages": 1, "cursor": "<base64>", "filter_cursor": "<base64>" }
```

`delivered_date_iso` is the date the claim window runs from (see §6).

The same endpoint serves the **claims list** with `screenType: "claims"` and a
flat `supplier_id`/`supplier_identifier` — not used by this flow.

### 5.2 `POST /api/experience/support/fetchSubCategory` — claim types and ids

**Function:** `getSubCategoryList(ctx, { subCategoryId })` → `MeeshoSubCategory[]`

```json
{ "supplier_id": <supplierId>, "identifier": "<slug>",
  "sub_category_id": "3", "is_pre_tp_enabled": false }
```

Each entry carries `sub_category_id`, `sub_category_title`, `description`,
`tat` (the SUPPORT response time in hours — 168 — **not** the claim window) and
`tatMessage`. `page_validation.restrict_ticket_creation` is what greys out the
portal's Raise Ticket button.

**Verified ids:** `1` = "I have received wrong return", `2` = "Item/s are
missing in my return", `3` = "I have received damaged return". Every other
`DefaultClaimsMeesho` type (BE `src/constants/common.ts`) is **unverified** and
falls back to `1`.

`resolveSubCategoryIdLive(ctx, typeOfClaim)` matches the CMS claim type against
the live titles and falls back to the table above, then to `1`. So a new id
Meesho adds works without a release.

### 5.3 `POST /api/experience/support/subcategorySchema` — the form definition

**Function:** `getSubCategorySchema(ctx, subCategoryId)` → `{ schema: TicketFormField[] }`

Returns the 14 fields of the ticket form with their `key`, `type`, `label` and
`req`. The `action_*` types are the ones the portal validates as you type.
Read for reference; the payload this flow sends is built from the CMS row.

### 5.4 `POST /api/experience/support/api/v1/upload/supplier-support/input-attachment`

**Function:** `uploadAttachment(ctx, filePath)` → the GCS URL

- Multipart with **two** fields:
  - the file itself — field name **unverified** (the capture does not include
    multipart bodies); `file` is the convention, override with
    `MEESHO_UPLOAD_FIELD`. The original filename is preserved (it shows up in
    the returned URL).
  - **`entity_type`** — required. Without it: `400 {"error":"Required
    SupportEntityType parameter 'entity_type' is not present"}`, which is what
    failed every claim on its first attachment. SupportEntityType is Meesho's
    supplier/agent enum (ticket updates carry `"entity_type":"AGENT"` on an
    agent reply), so a seller's upload is **`SUPPLIER`**. Override with
    `MEESHO_UPLOAD_ENTITY_TYPE`.
- Headers are the panel's own (`client-type: d-web`, `client-package-version`,
  `identifier`, the `sec-ch-ua` trio) plus a Referer inside `/support`.
- Response: `{ "url": "https://gcs-supl-…/TicketInputAttachments/<supplierId>/<epochMs>/<filename>", "is_valid": true, "errors": null }`.
- A rejected file answers 200 with `is_valid: false` — checked, not assumed.

### 5.5 `POST /api/experience/support/validateTicketField` — the TAT check

**Function:** `validateTicketField(ctx, { subOrderNumber, awbNumber, categoryId, subCategoryId })`
→ `{ isValid, errors[], raw }`

```json
{ "supplier_id": "<supplierId>", "category_id": "1", "sub_category_id": "3",
  "supplier_identifier": "<slug>",
  "ticket_details": [
    { "key": "sub_order_number", "type": "action_single_text_box", "label": "Sub Order Number", "value": "…_1" },
    { "key": "awb_number", "type": "action_single_text_box", "label": "AWB Number", "value": "<AWB>" } ] }
```

```json
{ "is_valid": false,
  "errors": [{ "error_message": "The dispute can only be claimed within 7 days of return delivery",
               "field_name": "awb_number" }],
  "success": null, "interaction_key": null }
```

The portal calls this per field as the operator types; sending the sub-order
number **and** the AWB together is what makes it answer about the claim window.
With a sub-order number missing it answers "Please enter a valid sub order
number." instead — a different problem.

**`tatVerdict(validation)`** turns that into `{ expired, message }`. Only a
message about a window, a day count or an expiry counts as expired; every other
refusal is left alone, because filing a wrong AWB away as "TAT Expired" hides a
fixable row behind a reason nobody can act on.

**Not part of filing.** `createTicket` enforces the same rule itself, so asking
first would double the calls a batch makes. It exists for Check TAT — see §6.

### 5.6 `POST /api/experience/support/createTicket` — the submit

**Function:** `createTicket(ctx, {...})` → `CreatedTicket`. Guarded by
`assertClaimSubmitEnabled` (`DESABLE_SAVE=true` stops here).

```json
{ "category_id": "1", "sub_category_id": "3",
  "supplier_id": "<supplierId>", "supplier_identifier": "<slug>",
  "supplier_email_id": "<login email>",
  "ticket_details": [
    { "key": "sub_order_number", "type": "action_single_text_box", "label": "Sub Order Number", "value": "…_1" },
    { "key": "awb_number", "type": "action_single_text_box", "label": "AWB Number", "value": "<AWB>" },
    { "key": "packet_state", "type": "drop_down", "label": "State of the packet", "value": "intact", "selectedLabel": "Intact" },
    { "key": "barcode_id", "type": "action_single_text_box", "label": "Packet ID", "value": "DLVPCE…" },
    { "key": "barcode_image_link", "type": "img_file", "label": "Barcode Image", "value": ["<gcs url>"] },
    { "key": "product_image_link", "type": "img_file", "label": "Image of product received", "value": ["<gcs url>"] },
    { "key": "product_reverse_way_bill_link", "type": "action_img_file", "label": "Reverse Waybill", "value": ["<gcs url>"] },
    { "key": "product_openingvideo_link", "type": "video_file", "label": "Unpacking Video", "value": ["<gcs url>"] },
    { "key": "ticket_desc", "type": "text_area", "label": "Description", "value": "…" },
    { "key": "attachments", "type": "img_file", "label": "Attachments", "value": [] },
    { "key": "callback_number", "type": "text_box", "label": "Callback Number", "value": "…" } ],
  "faq_classification_info": { "faq_classification_id": "",
      "supplier_selected_sub_category_id": 3, "supplier_selected_category_id": 1, "misc": {} } }
```

Success returns `{ ticket_id: 789478393183, ticket_creation_message, ticket_type: "Created", is_valid: true }`.

**A refusal is also a 200:**

```json
{ "ticket_id": null, "is_valid": false,
  "errors": [{ "field_name": "awb_number",
               "error_message": "The dispute can only be claimed within 7 days of return delivery" }] }
```

`createTicket` throws on that. A window message becomes `TAT_EXPIRED: …`
(`err.code = "TAT_EXPIRED"`); anything else becomes `CLAIM_REFUSED: …`. Both
carry Meesho's own words, because a claim refused for a reason nobody recorded
is one an operator cannot fix.

### 5.7 `POST /api/experience/support/searchTickets` — readback and dedupe

**Function:** `searchTicketsBySubOrder(ctx, subOrderNumber)` → ticket rows

```json
{ "supplier_id": <supplierId>, "page_num": 0, "page_size": 10,
  "search_ids": ["<sub order number>"] }
```

The flow tries the bare number and then `…_1`, because the portal's own search
used the suffixed form.

```json
{ "pagination": { "total_results": 1 },
  "results": [{ "ticket_id": 789478393183, "title": "I have received wrong return",
                "status": "Open", "supplier_support_sub_category_id": 1,
                "created_at": "2026-09-15T18:49:54",
                "estimated_response_time": "2026-09-22T18:49:54", … }],
  "tabs": [{ "name": "All" }, { "name": "Pending" }, { "name": "In Progress" }, { "name": "Closed" }] }
```

Used twice: **before** filing (a ticket already there means this claim is done,
and filing again would raise a second one) and **after**, when the submit
returned no id.

---

## 6. The claim window ("TAT")

Meesho gives a return **7 days from delivery** to raise a dispute (the wording
is in each sub-category's `description`, and the count can differ by
sub-category). Three ways to know, in descending order of authority:

1. **`createTicket` refuses it** — the marketplace's final answer, but only
   after every attachment has been uploaded.
2. **`validateTicketField` refuses it** — the same message, before anything is
   uploaded. This is what Check TAT uses.
3. **`delivered_date_iso` + 7 days** from the Returns search — arithmetic, not
   a verdict. Not used to fail a claim.

**Check TAT** (Trackvid-CMS, Claims page): the operator ticks rows and presses
the button. For each row the app finds the claim's account, asks
`validateTicketField`, and for a window refusal reports the claim to TrackVid as
a **terminal** failure — which moves it to **Failed to Proceed** with script
error **"TAT Expired"**. Nothing is written for a row that is still claimable or
one that could not be checked. The desktop side is
`electron/main/services/tatCheck.service.ts` plus the per-platform checker in
`automations/platforms/meesho/claim-management/common/tatCheck.ts`.

---

## 7. Status mapping

`searchTickets` reports `status` as `Open`, `Pending`, `In Progress` or
`Closed` (the ticket tabs). `MEESHO_TO_CMS_STATUS` maps the lower-cased,
underscored form; anything unrecognised maps to `null`, which leaves the CMS
status untouched.

**Unverified:** `Closed` currently maps to Approved. A closed Meesho ticket can
equally be a rejected one, so confirm against a real rejected claim before
relying on it.

---

## 8. Environment variables

| Variable | Effect |
|---|---|
| `MEESHO_API_DEBUG=true` | verbose `[meesho-api]` logging |
| `MEESHO_API_TIMEOUT_MS` | per-request timeout (default 60000) |
| `MEESHO_UPLOAD_FIELD` | multipart field name for the file (default `file`) |
| `MEESHO_UPLOAD_ENTITY_TYPE` | the upload's `entity_type` form field (default `SUPPLIER`) |
| `MEESHO_SESSION_SAVE=false` / `MEESHO_SESSION_CACHE=false` | disable the session cache |
| `DESABLE_SAVE=true` | everything runs except `createTicket` |

---

## 9. When an API breaks

1. **Read the failure line.** `logApiFailure` prints the step name (e.g.
   `Validate ticket field`), the status and the body. The step names the
   function in §5.
2. **Classify it.**
   - `403 Access Denied` (HTML): the CDN, not Meesho. The UA or the client
     headers are missing or stale — §4.
   - `400 Invalid client type`: `client-type` missing.
   - `463 Token missing`: the session is dead. Re-capture it.
   - `403 errorCode 1001 "Identifier not present or invalid"`: the slug is
     missing from the context, NOT an expired session — check
     `ensureSupplierIdentity` and the stored `supplierIdentifier`.
   - `403 "Access Denied"` HTML on the identity call: it takes `client-type:
     web` and no `client-package-version`; the panel's headers are refused.
   - `400 Required … parameter 'entity_type' is not present` (upload) or
     `400 AssertTrue.supplierTicketValidationRequest.valid` (validate/create):
     a field is missing from the body — the second one means `supplier_id` went
     out empty, i.e. the session had no identity.
   - A 200 that "worked" but nothing was filed: read `is_valid` and `errors[]`.
     That is where Meesho puts refusals.
   - Empty Returns search for an AWB the portal can see: check
     `filters.shipment_status` is `search_return_rto` and that `supplier_details`
     carries both the slug and the numeric id.
3. **Record the portal doing it by hand**, then compare path, body field names
   (watch the string-vs-number spellings in §4) and the client headers.
4. **Change the call in `claimApiFlow.js`, the typedef in `meeshoApiTypes.js`
   and this file together.**
5. **Check it.** From the core: `npm run build`. Then boot Automated-Scripts
   (`node server.js`), run `npm run verify` in Trackvid-CMS (which includes
   `tests/tatCheck.test.ts`), and copy the changed core files to the other
   consumer's core checkout so both stay identical.
6. **Delete the capture** and sign that Meesho session out.
